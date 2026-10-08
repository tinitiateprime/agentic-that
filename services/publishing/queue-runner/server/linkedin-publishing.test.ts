import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "playwright-core";
import { detectedExternalBrowserExecutablePath } from "./engines/external-browser/index.js";
import { linkedInManagedPageFromLink, openLinkedInManagedPagePosts, postToLinkedIn } from "./services/publishers/linkedin.js";
import type { PlatformUpload } from "../shared/schema.js";

const executablePath = detectedExternalBrowserExecutablePath();
const origin = "https://www.linkedin.com";
const pageId = "117884053";
const pageName = "Tinitiate AI Solutions";
const dashboardPath = `/company/${pageId}/admin/dashboard/`;
const postsPath = `/company/${pageId}/admin/page-posts/published/`;
const target = linkedInManagedPageFromLink(pageName, `${origin}/company/tinitiate-ai/`)!;
const numericTarget = linkedInManagedPageFromLink(pageName, `${origin}${dashboardPath}`)!;

function feed() {
  return `<section><h2>Manage</h2>
    <a href="/company/999/admin/dashboard/">Other managed Page</a>
    <a href="${dashboardPath}">${pageName}</a>
  </section>`;
}

function dashboard(control: string) {
  return `<h1>${pageName}</h1><aside>Dashboard${control}</aside>`;
}

function composer() {
  return `<section role="dialog" id="composer" hidden>
    <div class="tiptap ProseMirror" contenteditable="true" role="textbox"></div>
    <button onclick="if(event.isTrusted)window.submitPost()">Post</button>
  </section>`;
}

function posts(createMenu = false, delayed = false) {
  const controls = createMenu
    ? `<button onclick="if(event.isTrusted)document.querySelector('#create-menu').hidden=false">+ Create</button>
       <div id="create-menu" role="menu" hidden>
         <div role="menuitem" tabindex="0" onclick="if(event.isTrusted)document.querySelector('#composer').hidden=false">Create a post</div>
         <div role="menuitem">Create an article</div>
       </div>`
    : `<button onclick="if(event.isTrusted)document.querySelector('#composer').hidden=false">Start a post</button>`;
  return `<h1>${pageName}</h1><aside>Page posts</aside>
    <main id="posts-content" ${delayed ? "hidden" : ""}>${controls}</main>${composer()}
    <script>${delayed ? "setTimeout(()=>document.querySelector('#posts-content').hidden=false,2200);" : ""}
      window.submitPost=async()=>{
        const caption=document.querySelector('[contenteditable]').innerText;
        const response=await fetch('/voyager/api/contentcreation/normShares',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caption,pageId:'${pageId}'})
        });
        document.querySelector('#composer').remove();
        const notice=document.createElement('div');notice.setAttribute('role',response.ok?'status':'alert');
        notice.textContent=response.ok?'Post successful':'Your post failed';document.body.append(notice);
      };
    </script>`;
}

async function withBrowser(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ executablePath: executablePath!, headless: true });
  try { await run(await browser.newPage()); }
  finally { await browser.close(); }
}

function textUpload(linkedinTarget = target) {
  return {
    caption: "A Page update\nwith the exact requested caption.",
    postFormat: "text", mimeType: "text/plain", fileName: "", linkedinTarget,
  } as PlatformUpload;
}

test("LinkedIn publishes to the selected Manage Page through a non-link sidebar and Create menu", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    const submitted: unknown[] = [];
    await page.route(`${origin}/**`, async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes('/voyager/api/')) {
        submitted.push(request.postDataJSON());
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
        return;
      }
      const body = pathname === '/login/' || pathname === '/feed/' ? feed()
        : pathname === dashboardPath ? dashboard(`<div tabindex="0" onclick="if(event.isTrusted){sessionStorage.setItem('pagePostsClicked','yes');location.href='${postsPath}'}"><span>Page posts</span></div>`)
        : pathname === postsPath ? posts(true, true) : '<h1>Unexpected destination</h1>';
      await route.fulfill({ contentType: 'text/html', body });
    });
    let finalActions = 0;
    assert.deepEqual(await postToLinkedIn(page, textUpload(), {
      useSavedSessionOnly: true, onFinalActionSubmitted: () => { finalActions += 1; },
    }), { success: true });
    assert.equal(new URL(page.url()).pathname, postsPath);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('pagePostsClicked')), 'yes');
    assert.deepEqual(submitted, [{ caption: textUpload().caption, pageId }]);
    assert.equal(finalActions, 1);
  });
});

test("LinkedIn follows a numeric Page redirect to Dashboard and clicks the Page posts tab", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    let postsVisits = 0;
    await page.route(`${origin}/**`, async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === postsPath && postsVisits++ === 0) {
        await route.fulfill({ contentType: 'text/html', body:
          `<script>history.replaceState(null,'','${dashboardPath}')</script>`
          + dashboard(`<div role="tab" onclick="if(event.isTrusted){sessionStorage.setItem('tabClicked','yes');location.href='${postsPath}'}">Page posts</div>`) });
        return;
      }
      await route.fulfill({ contentType: 'text/html', body: pathname === dashboardPath
        ? dashboard(`<div role="tab" onclick="if(event.isTrusted){sessionStorage.setItem('tabClicked','yes');location.href='${postsPath}'}">Page posts</div>`)
        : posts(false, true) });
    });
    await openLinkedInManagedPagePosts(page, numericTarget);
    assert.equal(new URL(page.url()).pathname, postsPath);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tabClicked')), 'yes');
    assert.equal(await page.getByRole('button', { name: 'Start a post' }).isVisible(), true);
  });
});

test("LinkedIn recovers an ignored Page posts link using only the verified canonical Page ID", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    const visited: string[] = [];
    await page.route(`${origin}/**`, route => {
      const pathname = new URL(route.request().url()).pathname;
      visited.push(pathname);
      return route.fulfill({ contentType: 'text/html', body: pathname === '/feed/' ? feed()
        : pathname === dashboardPath ? dashboard(`<a href="${postsPath}" onclick="event.preventDefault();sessionStorage.setItem('ignoredClick','yes')"><span>Page posts</span></a>`)
        : posts() });
    });
    await openLinkedInManagedPagePosts(page, target);
    assert.equal(new URL(page.url()).pathname, postsPath);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ignoredClick')), 'yes');
    assert.ok(!visited.some(path => path.startsWith('/company/tinitiate-ai/admin/')));
  });
});

test("LinkedIn refuses a sidebar link that belongs to another managed Page", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    const visited: string[] = [];
    await page.route(`${origin}/**`, route => {
      const pathname = new URL(route.request().url()).pathname;
      visited.push(pathname);
      return route.fulfill({ contentType: 'text/html', body: pathname === '/feed/' ? feed()
        : dashboard('<a href="/company/999/admin/page-posts/published/">Page posts</a>') });
    });
    await assert.rejects(openLinkedInManagedPagePosts(page, target), /points to a different Page/);
    assert.ok(!visited.some(path => path.startsWith('/company/999/')));
  });
});

test("LinkedIn refuses a public slug redirect with a different visible Page identity", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body:
      new URL(route.request().url()).pathname === '/feed/'
        ? `<section><h2>Manage</h2><a href="/company/tinitiate-ai/">${pageName}</a></section>`
        : `<script>history.replaceState(null,'','/company/999/admin/dashboard/')</script><h1>Other managed Page</h1><button>Start a post</button>` }));
    await assert.rejects(openLinkedInManagedPagePosts(page, target), /could not verify the selected Page/);
    assert.equal(await page.locator('[contenteditable]').count(), 0);
  });
});

test("LinkedIn reports a rejected Page submission after one trusted Post click", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    let requests = 0;
    await page.route(`${origin}/**`, route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.includes('/voyager/api/')) {
        requests += 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ contentType: 'text/html', body: pathname === '/feed/' ? feed() : posts() });
    });
    let submitted = 0;
    await assert.rejects(postToLinkedIn(page, textUpload(numericTarget), {
      useSavedSessionOnly: true, onFinalActionSubmitted: () => { submitted += 1; },
    }), /LinkedIn rejected the post: Your post failed/);
    assert.equal(requests, 1);
    assert.equal(submitted, 1);
  });
});

test("LinkedIn personal publishing still opens Start a post and submits the exact caption once", { skip: !executablePath }, async () => {
  await withBrowser(async page => {
    const submitted: unknown[] = [];
    await page.route(`${origin}/**`, route => {
      if (route.request().url().includes('/voyager/api/')) {
        submitted.push(route.request().postDataJSON());
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({ contentType: 'text/html', body: posts() });
    });
    const upload = textUpload();
    delete upload.linkedinTarget;
    assert.deepEqual(await postToLinkedIn(page, upload, { useSavedSessionOnly: true }), { success: true });
    assert.equal(new URL(page.url()).pathname, '/feed/');
    assert.equal(submitted.length, 1);
    assert.equal((submitted[0] as { caption: string }).caption, upload.caption);
  });
});

test("LinkedIn does not report success when the composer closes without provider acceptance", { skip: !executablePath }, async t => {
  const originalTimeout = process.env.LINKEDIN_POST_CONFIRMATION_TIMEOUT_MS;
  process.env.LINKEDIN_POST_CONFIRMATION_TIMEOUT_MS = '30000';
  t.after(() => {
    if (originalTimeout === undefined) delete process.env.LINKEDIN_POST_CONFIRMATION_TIMEOUT_MS;
    else process.env.LINKEDIN_POST_CONFIRMATION_TIMEOUT_MS = originalTimeout;
  });
  await withBrowser(async page => {
    await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body:
      posts() + `<script>window.submitPost=()=>document.querySelector('#composer').remove()</script>` }));
    const upload = textUpload();
    delete upload.linkedinTarget;
    let submitted = 0;
    await assert.rejects(postToLinkedIn(page, upload, {
      useSavedSessionOnly: true, onFinalActionSubmitted: () => { submitted += 1; },
    }), /LinkedIn did not confirm the post within 30 seconds/);
    assert.equal(submitted, 1);
  });
});
