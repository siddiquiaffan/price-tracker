// Copy this whole code into cloudflare worker and add WORKER_URL in environment variable.

async function gatherResponse(response) {
    const { headers } = response
    const contentType = headers.get("content-type") || ""
    if (contentType.includes("application/json")) {
        return JSON.stringify(await response.json())
    }
    else if (contentType.includes("application/text")) {
        return response.text()
    }
    else if (contentType.includes("text/html")) {
        return response.text()
    }
    else {
        return response.text()
    }
}

async function handleRequest(request) {

    let method = request.method;
    let request_headers = request.headers;
    let new_request_headers = new Headers(request_headers);
    let url = new URL(request.url)
    let params = new URLSearchParams(url.search.substring(1));

    const path = decodeURIComponent(url.searchParams.get('url'));
    const response = await fetch(path, {
        method: method,
        headers: new_request_headers
    })
    const results = await gatherResponse(response)
    return new Response(results, {
        headers: response.headers
    })
}

addEventListener("fetch", async event => {
    event.respondWith(handleRequest(event.request))
})