import { chromium } from "npm:playwright";
import { ensureDir } from "https://deno.land/std@0.184.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.184.0/path/mod.ts";

function extractUrlsFromSitemap(sitemapXml: string): string[] {
  const regex = /<loc>(.*?)<\/loc>/g;
  const matches = sitemapXml.match(regex);
  return matches ? matches.map(match => match.replace(/<\/?loc>/g, '')) : [];
}

async function crawlUrl(url: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Disable AJAX requests before navigating to the page
    // await page.addInitScript(() => {
    //   window.XMLHttpRequest = class {
    //     open() {}
    //     send() {}
    //     setRequestHeader() {}
    //   } as any;
    //   window.fetch = () => Promise.reject('fetch is disabled');
    // });

    await page.goto(url, { waitUntil: "networkidle" });

    const urlObj = new URL(url);
    const dirName = 'pages/' + urlObj.hostname + urlObj.pathname.replace(/\//g, "_");
    await ensureDir(dirName);

    // Get HTML content and replace internal URLs
    let html = await page.content();
    html = await page.evaluate((baseUrl) => {
      const replaceUrl = (el: Element, attr: string) => {
        const value = el.getAttribute(attr);
        if (value && !value.startsWith('http') && !value.startsWith('//') && !value.startsWith('data:')) {
          el.setAttribute(attr, new URL(value, baseUrl).href);
        }
      };

      // Replace URLs in navigation and resource loading elements
      document.querySelectorAll('a').forEach(el => replaceUrl(el, 'href'));
      document.querySelectorAll('img, link[href]').forEach(el => replaceUrl(el, el.tagName === 'LINK' ? 'href' : 'src'));
      
      // Remove all script tags
      document.querySelectorAll('script').forEach(el => el.remove());

    //   document.querySelectorAll('form').forEach(el => replaceUrl(el, 'action'));

      return document.documentElement.outerHTML;
    }, url);

    // Inject script to disable AJAX in the saved HTML
    // const disableAjaxScript = `
    //   <script>
    //     window.XMLHttpRequest = class {
    //       open() {}
    //       send() {}
    //       setRequestHeader() {}
    //     };
    //     window.fetch = () => Promise.reject('fetch is disabled');
    //   </script>
    // `;
    // html = html.replace('</head>', `${disableAjaxScript}</head>`);

    // Save HTML with replaced URLs and disabled AJAX
    await Deno.writeTextFile(join(dirName, "index.html"), html);

    // Save CSS
    const stylesheets = await page.evaluate(() => {
      return Array.from(document.styleSheets).map(stylesheet => stylesheet.href).filter(href => href !== null);
    });

    for (const stylesheet of stylesheets) {
      const cssResponse = await fetch(stylesheet);
      const cssContent = await cssResponse.text();
      const cssFileName = new URL(stylesheet).pathname.split("/").pop() || "styles.css";
      await Deno.writeTextFile(join(dirName, cssFileName), cssContent);
    }

    // Save assets (images, fonts, etc.)
    const assets = await page.evaluate(() => {
      const images = Array.from(document.images).map(img => img.src);
      const fonts = Array.from(document.styleSheets)
        .flatMap(sheet => Array.from(sheet.cssRules))
        .filter(rule => rule.type === CSSRule.FONT_FACE_RULE)
        .map(rule => (rule as CSSFontFaceRule).style.getPropertyValue('src'))
        .flatMap(src => src.match(/url\(['"]?(.+?)['"]?\)/g) || [])
        .map(url => url.replace(/url\(['"]?(.+?)['"]?\)/, '$1'));
      return [...images, ...fonts];
    });

    for (const asset of assets) {
      try {
        const assetResponse = await fetch(asset);
        const assetBuffer = await assetResponse.arrayBuffer();
        const assetFileName = new URL(asset).pathname.split("/").pop() || "asset";
        await Deno.writeFile(join(dirName, assetFileName), new Uint8Array(assetBuffer));
      } catch (error) {
        console.error(`Failed to download asset: ${asset}`, error);
      }
    }

    console.log(`Crawled and saved: ${url}`);
  } catch (error) {
    console.error(`Failed to crawl: ${url}`, error);
  } finally {
    await browser.close();
  }
}

async function main() {
// await Deno.remove("pages", { recursive: true }).catch((error) => {
//     if (error instanceof Deno.errors.NotFound) {
//         console.log("Folder 'pages' does not exist, skipping removal.");
//     } else {
//         throw error;
//     }
//     });
    
  const urls = extractUrlsFromSitemap(sitemap);//.slice(0, 3);
  console.log(`Found ${urls.length} URLs to crawl`);

  for (const url of urls) {
    await crawlUrl(url);
  }
}

main();
