import {DEFAULT_EXPIRATION, Env} from "./index";

export type Link = {
    id: string
    key: string
    location: string
    expiration: number
}

export class LinkStore implements DurableObject {

    state: DurableObjectState
    env: Env
    constructor(state: DurableObjectState, env: Env) {
        this.state = state
        this.env = env
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)
        const location = url.searchParams.get('location') ?? ''
        let expiration = parseInt(url.searchParams.get('expiration') ?? `${DEFAULT_EXPIRATION}`)
        if (isNaN(expiration)) {
            expiration = DEFAULT_EXPIRATION
        }

        if (request.method === "POST") {
            // parse link request, create unique id, create unique security key
            const id = crypto.randomUUID().substring(0, 8)
            const key = crypto.randomUUID()
            const link: Link = {
                id,
                key,
                location: location,
                expiration: Date.now() + expiration
            }
            // TODO prevent id collision, if expired then overwrite
            // save link into DO and KV
            await this.state.storage?.put<Link>(id, link)
            await this.env.LINKS.put(id, link.location, {expirationTtl: expiration})
            this.env.LINK_DATA.writeDataPoint({
                indexes: [id],
                blobs: [request.method, request.headers.get('cf-connecting-ip') ?? '']
            })
            return new Response(JSON.stringify(link))
        }

        const id = url.pathname.slice(1)
        const link = await this.state.storage?.get<Link>(id)
        if (!link) {
            // if link doesn't exist for id
            if (request.method === 'DELETE') {
                // return ok if DELETE (idempotent)
                return new Response(JSON.stringify({id}))
            }
            // return not found if not DELETE
            return new Response('not found', {status: 404})
        }

        const key = url.searchParams.get('key')
        if (!key || key !== link.key) {
            // return unauthorized if key is missing or doesn't match for the link
            return new Response('not authorized', {status: 401})
        }

        if (request.method === 'DELETE') {
            // delete link from DO and KV
            await this.env.LINKS.delete(id)
            await this.state.storage.delete(id)
            this.env.LINK_DATA.writeDataPoint({
                indexes: [id],
                blobs: [request.method, request.headers.get('cf-connecting-ip') ?? '']
            })
            return new Response(JSON.stringify({id}))
        }

        return new Response('not allowed', {status: 405})
    }
}