import {Env} from "./index";

export type CreateLinkRequest = Omit<Link, "id" | "key">

export type ModifyLinkRequest = Omit<Link, "id">

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

        if (request.method === "POST") {
            // parse link request, create unique id, create unique security key
            // TODO validate the request data
            const data = await request.json() as CreateLinkRequest
            const id = crypto.randomUUID().substring(0, 8)
            const key = crypto.randomUUID()
            const link: Link = {
                id,
                key,
                location: data.location,
                expiration: Date.now() + data.expiration
            }
            // TODO prevent id collision, if expired then overwrite
            // save link into DO and KV
            await this.state.storage?.put<Link>(id, link)
            await this.env.LINKS.put(id, link.location, {expirationTtl: data.expiration})
            this.env.LINK_DATA.writeDataPoint({
                indexes: [id],
                blobs: [request.method, request.headers.get('cf-connecting-ip') ?? '']
            })
            return new Response(JSON.stringify(link))
        }

        const id = url.pathname.slice(1)
        const link = await this.state.storage?.get<Link>(id)
        if (!link) {
            console.log({
                link,
                id
            })
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

        const data = await request.json() as ModifyLinkRequest
        if (request.method === 'PUT') {
            // update link details from request
            // TODO validate the request data
            link.location = data.location
            link.expiration = Date.now() + data.expiration
            await this.state.storage?.put<Link>(id, link)
            await this.env.LINKS.put(id, link.location, {expirationTtl: data.expiration})
            this.env.LINK_DATA.writeDataPoint({
                indexes: [id],
                blobs: [request.method, request.headers.get('cf-connecting-ip') ?? '']
            })
            return new Response(JSON.stringify(link))
        }

        return new Response('not allowed', {status: 405})
    }
}