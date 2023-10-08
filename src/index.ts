import { Axiom } from '@axiomhq/js';
import { randomUUID } from 'crypto';
import outdent from 'outdent';

const axiom = new Axiom({
    token: process.env.AXIOM_TOKEN!,
    orgId: process.env.AXIOM_ORG_ID!,
});

const ONE_SECOND = 1_000;
const ONE_MINUTE = 60 as const * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_YEAR = ONE_DAY * 365;
const units = {
    m: ONE_MINUTE,
    h: ONE_HOUR,
    d: ONE_DAY,
    y: ONE_YEAR,
};

const getViewsForId = async (id: string, unit: 'h' | 'd' | 'm' | 'y', length: number) => {
    return await axiom.query(`['view-counter'] | where eventType == "view" | where id == "${id}" | summarize count()`, {
        startTime: new Date(Date.now() - (length * units[unit])).toISOString(),
        endTime: new Date(Date.now()).toISOString(),
    }).then(result => result.buckets.totals?.[0].aggregations?.[0].value).catch(error => 0);
};

type Metadata = {
    method: string;
    headers: Record<string, string | null | undefined>;
};

const addViewForId = async (id: string, request: Request) => {
    const safeHeaders = {
        'User-Agent': request.headers.get('User-Agent'),
        'X-Forwarded-For': request.headers.get('X-Forwarded-For'),
    };

    const metadata = {
        method: request.method,
        headers: safeHeaders,
    } satisfies Metadata;

    axiom.ingest(process.env.AXIOM_DATASET!, {
        eventType: 'view',
        id,
        metadata,
    });
};

const transparentPixelBase64Blob = 'R0lGODlhAQABAPAAAAAAAAAAACH5BAUKAAAALAAAAAABAAEAQAICRAEAOw=';
const transparentPixel = Buffer.alloc(transparentPixelBase64Blob.length)
transparentPixel.write(transparentPixelBase64Blob, 'base64');

const server = Bun.serve({
    port: process.env.PORT ?? 8080,
    async fetch(request) {
        const url = new URL(request.url);
        console.log(`${request.method} ${request.url}`);
        switch (url.pathname) {
            case '/':
                return new Response(outdent`
                    <!DOCTYPE html>
                    <html>
                        <head>
                            <title>Free and easy pixel view counter</title>
                            <style>html, body { background: #09090b; color: #a1a1aa; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"; }</style>
                        </head>
                        <body>
                            <span>Please include the following html on your page to start tracking views.</span>
                            <pre>&lt;img src="<script id='hostname_script'>document.getElementById('hostname_script').outerHTML = window.location.href</script>pixel.gif?id=${randomUUID()}" /&gt;</pre>
                            <img src="/pixel.gif?id=view-counter" />
                        </body>
                    </html>
                `.replace(/>\s+</g, '><').trim(), {
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                    }
                });
            case '/views': {
                // Example: ?id=abc&period=1y
                //           id=abc
                //           length=1
                //           unit=y
                const id = url.searchParams.get('id')?.match(/[a-z\d\.\-]+/)?.[0];
                if (!id) return new Response(`Error: URL is missing "id" in the query string.`);
                const period = url.searchParams.get('period');
                if (!period) return new Response(`Error: URL is missing "period" in the query string.`);
                const length = Number(period.match(/\d+/)?.[0] ?? '-1');
                const unit = period.match(/[a-z]+/)?.[0] as 'h' | 'd' | 'm' | 'y' | undefined;
                if (!length || !unit) return new Response(`Error: Value for "period" query param is invalid.`);
                if (!Object.keys(units).includes(unit)) return new Response('Error: Value for "unit" query param is invalid.');
                if (length >= 1000) return new Response('Error: "length" is too large.');

                // Get views from axiom for id over length of unit
                const views = await getViewsForId(id, unit, length);
                return new Response(JSON.stringify(views, null, 2), {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
            }
            case '/pixel.gif': {
                const id = url.searchParams.get('id')?.match(/[a-z\d\.\-]+/)?.[0];
                if (!id) return new Response(`Error: URL is missing "id" in the query string.`);

                // Record the view
                void addViewForId(id, request).catch(error => {
                    console.error(`Failed to add view`, {
                        id,
                        cause: error,
                    });
                });

                // Reply with transparent gif
                return new Response(transparentPixel, {
                    headers: {
                        'Content-Type': 'image/gif',
                    },
                });
            }
            case '/favicon.ico': {
                // Reply with transparent gif
                return new Response(transparentPixel, {
                    headers: {
                        'Content-Type': 'image/gif',
                    },
                });
            }
            default:
                return new Response('Page not found.');
        }
    },
});

console.log(`Listening at http://localhost:${server.port}`);
