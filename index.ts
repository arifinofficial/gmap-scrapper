import { Browser, Page } from "puppeteer";
import { promises as fs } from "fs";
import env from "dotenv";
import puppeteer from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import prompt from "prompt";

interface Service {
  title: string | null | undefined;
  services: (string | null)[];
}

interface ResultData {
  dataId: string | undefined;
  url: string | null;
  title: string;
  position: number;
  coordinates: any;
  rating: number;
  reviews: number;
  type: string;
  address: string;
  phone: string;
  website: string;
  operating_hours: any[];
  services: Service[];
}

env.config({ path: ".env" });
puppeteer.use(stealthPlugin());
const { LATITUDE = "", LONGITUDE = "" } = process.env;
prompt.message = "";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function consoleInfo(text: string) {
  console.info(
    "\x1b[44m",
    "\x1b[37m",
    "\u2139",
    "\x1b[0m",
    "\x1b[36m",
    text,
    "\x1b[0m"
  );
}

async function scrollResult(
  page: Page,
  container: string,
  limit: number
): Promise<void> {
  consoleInfo("Getting places concurrently...");
  let lastHeight = await page.evaluate(
    `document.querySelector("${container}").scrollHeight`
  );

  while (true) {
    await page.evaluate(
      `document.querySelector("${container}").scrollTo(0, document.querySelector("${container}").scrollHeight)`
    );
    await page.waitForNetworkIdle();
    let newHeight = await page.evaluate(
      `document.querySelector("${container}").scrollHeight`
    );
    const countItem = (await page.evaluate(
      "document.querySelectorAll('.hfpxzc').length"
    )) as number;
    if (newHeight === lastHeight || limit <= countItem) {
      break;
    }
    lastHeight = newHeight;
  }
}

async function gettingDataFromPage(
  page: Page,
  limit: number
): Promise<ResultData[]> {
  consoleInfo("Start scrapping data...");
  const elements = await page.$$("a.hfpxzc");
  let data: ResultData[] = [];

  for (let i = 0; i < limit; i++) {
    process.stdout.write('Processing ' + ((i/limit) * 100) + '%... \r');

    const url = await page.evaluate(
      (el) => el.getAttribute("href"),
      elements[i]
    );
    const urlPattern =
      /!1s(?<id>[^!]+).+!3d(?<latitude>[^!]+)!4d(?<longitude>[^!]+)/gm;
    const dataId =
      url != null
        ? [...url.matchAll(urlPattern)].map(({ groups }) => groups?.id)[0]
        : "";
    const latitude =
      url != null
        ? [...url.matchAll(urlPattern)].map(({ groups }) => groups?.latitude)[0]
        : "";
    const longitude =
      url != null
        ? [...url.matchAll(urlPattern)].map(
            ({ groups }) => groups?.longitude
          )[0]
        : "";

    // Click list item
    await elements[i].click();
    await page.waitForNavigation();
    await page.waitForSelector(".DUwDvf");
    await delay(1000);

    // Get data from detail item
    const title = (await page.evaluate(
      `document.querySelector(".iD2gKb.W1neJ")?.textContent`
    )) as string;
    const rating = (await page.evaluate(
      "document.querySelector('.F7nice > span:nth-child(1) > span:nth-child(1)')?.textContent"
    )) as string;
    const ratingNumber = Number(rating.replace(",", "."));
    const reviews = (await page.evaluate(
      "document.querySelector('.F7nice > span:nth-child(2) > span > span')?.textContent"
    )) as string;
    const type = (await page.evaluate(
      "document.querySelector('.skqShb .DkEaL')?.textContent"
    )) as string;
    const address = (await page.evaluate(
      `document.querySelector(".bJzME.Hu9e2e.tTVLSc .CsEnBe[data-item-id='address'] > .AeaXub > .rogA2c")?.textContent`
    )) as string;
    const phone = (await page.evaluate(
      `document.querySelector(".bJzME.Hu9e2e.tTVLSc .CsEnBe[data-item-id^='phone'] > .AeaXub > .rogA2c")?.textContent`
    )) as string;
    const website = (await page.evaluate(
      `document.querySelector(".bJzME.Hu9e2e.tTVLSc .CsEnBe[data-item-id='authority']")?.getAttribute("href")`
    )) as string;

    // Get opening hours
    const operatingHours = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(
          ".bJzME.Hu9e2e.tTVLSc .t39EBf.GUrTXd table.eK4R0e tbody tr"
        )
      ).map((el) => {
        console.log(el);
        return {
          dayName: el.querySelector("td.ylH6lf > div")?.textContent,
          hours: el.querySelector("td.mxowUb ul li.G8aQO")?.textContent,
        };
      });
    });

    // Click about tab in detail item
    const tabABout = await page.$("button.hh2c6[data-tab-index='2']");
    tabABout?.click();
    await page.waitForNetworkIdle();
    await delay(1000);

    // Get services
    const services = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(".m6QErb.DxyBCb.kA9KIf.dS8AEf .iP2t7d")
      ).map((el) => {
        return {
          title: el.querySelector("h2")?.textContent,
          services: Array.from(
            el.querySelectorAll("ul li:not([class*='WeoVJe']) span")
          ).map((service) => service.textContent),
        };
      });
    });

    data.push({
      dataId: dataId,
      url: url,
      title: title,
      position: i + 1,
      coordinates: {
        latitude: latitude,
        longitude: longitude,
      },
      rating: ratingNumber,
      reviews: Number(reviews.replace(/[^0-9]/g, "")),
      type: type,
      address: address,
      services: services,
      phone: phone || "",
      website: website || "",
      operating_hours: operatingHours,
    });
  }

  consoleInfo("Making new map of scrapping results...");
  return data;
}

async function main() {
  try {
    consoleInfo("Checking environment...");
    if (!LONGITUDE || !LATITUDE)
      throw new Error("`LONGITUDE` or `LATITUDE` must be set on `.env` file");

    const { search, limit }: { search: string; limit: string } =
      await prompt.get([
        {
          name: "search",
          description: "Search",
          required: true,
        },
        {
          name: "limit",
          description: "Limit",
          required: true,
          type: "number",
        },
      ]);

    consoleInfo("Running the agent...");
    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page: Page = await browser.newPage();

    const URL = `https://www.google.com/maps/search/${search}/@${LATITUDE},${LONGITUDE},17z`;
    page.setDefaultNavigationTimeout(60000);
    await page.goto(URL);
    await page.waitForNavigation();

    const scrollContainer = ".m6QErb[aria-label]";
    await scrollResult(page, scrollContainer, Number(limit));
    const data: ResultData[] = await gettingDataFromPage(page, Number(limit));

    consoleInfo("Storing data into JSON file...");
    const fileName = `${search}-${new Date().getTime()}.json`;
    await fs.writeFile(`./data/${fileName}`, JSON.stringify(data, null, 2));

    await browser.close();
    consoleInfo("Finish...");
  } catch (error) {
    console.log(error);
  }
}

main();
