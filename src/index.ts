/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
export {LinkStore} from './link'

let encoder: TextEncoder | null = null

export async function hash(value: string): Promise<number> {
	if(encoder === null) {
		encoder = new TextEncoder()
	}
	const data = encoder.encode(value)
	const buf = await crypto.subtle.digest('SHA-1', data)
	const dv = new DataView(buf)
	return dv.getUint32(0)
}


export interface WorkerAnalyticsNamespace {
	writeDataPoint(data: DataPoint): void
}

// how many DurableObjects to spread links between
// each object can handle 100~RPS
const LINK_STORE_SHARD_COUNT = 3

// 1 day default expiration
export const DEFAULT_EXPIRATION = 60 * 60 * 24

export interface DataPoint {
	blobs?: string[]
	doubles?: number[]
	indexes?: string[]
}
export interface Env {
	LINKS: KVNamespace;
	LINK_STORE: DurableObjectNamespace;

	LINK_DATA: WorkerAnalyticsNamespace
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url)

		if (request.method === 'GET') {
			const id = url.pathname.slice(1)
			if (id === '') {
				return new Response('not found', {status: 404})
			}
			// get location associated with key
			// if not found, return 404
			// if found, return 301 redirect
			env.LINK_DATA.writeDataPoint({
				indexes: [id],
				blobs: [request.method, request.headers.get('cf-connecting-ip') ?? '']
			})
			const location = await env.LINKS.get(id)
			if (!location) {
				return new Response('not found', {status: 404})
			}
			return new Response('found', {status: 301, headers: { 'Location': location }})
		}

		if (request.method === 'POST') {
			const location = url.searchParams.get('location')

			if (!location) {
				return new Response('invalid location', {status: 400})
			}
			const h = await hash(location)
			const index = h % LINK_STORE_SHARD_COUNT
			const objId = env.LINK_STORE.idFromName(`${index}`)
			const obj = env.LINK_STORE.get(objId)
			return obj.fetch(request)
		}

		if (request.method === 'DELETE') {
			const id = url.pathname.slice(1)
			if (id === '') {
				return new Response('not found', {status: 404})
			}
			const location = await env.LINKS.get(id)
			if (!location) {
				return new Response('not found', {status: 404})
			}
			const h = await hash(location)
			const index = h % LINK_STORE_SHARD_COUNT
			const objId = env.LINK_STORE.idFromName(`${index}`)
			const obj = env.LINK_STORE.get(objId)
			return obj.fetch(request)
		}

		return new Response('not allowed', {status: 405})
	}
};
