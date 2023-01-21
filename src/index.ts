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

export interface WorkerAnalyticsNamespace {
	writeDataPoint(data: DataPoint): void
}

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

		if (request.method === 'GET') {
			const url = new URL(request.url)
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

		if (['POST', 'DELETE', 'PUT'].includes(request.method)) {
			// direct request to DurableObject to handle modifications
			const objId = env.LINK_STORE.idFromName('LINK_STORE')
			const obj = env.LINK_STORE.get(objId)
			return obj.fetch(request)
		}

		return new Response('not allowed', {status: 405})
	}
};
