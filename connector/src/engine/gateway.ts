/**
 * The gateway header: how the engine learns which ACCOUNT a hosted request belongs to, so its rate
 * limits apply per account instead of to one shared loopback address — and how it learns that the
 * key the request is signed with is one Agent Eve's server holds (`signer: hosted`).
 *
 *   X-Eve-Gateway-Account: <account uuid>
 *   X-Eve-Gateway-Time:    <unix seconds>
 *   X-Eve-Gateway-Mac:     base64url( HMAC-SHA256( secret,
 *                            "eve-gateway-v1\n" METHOD "\n" PATH "\n" ACCOUNT "\n" TIME "\n" CONTENT-DIGEST ) )
 *
 * ONE HOME. This file re-exports the engine's own module (`engine/src/api/gateway.ts`, bundled in at
 * build and shipped by `deploy/deploy-mcp.py`), so the headers this service SENDS are built by the same
 * function the engine VERIFIES with — header names, MAC input and skew window cannot drift apart. The
 * secret is this service's `EVE_GATEWAY_SECRET` and the engine's `COMPACT_GATEWAY_SECRET`: one value,
 * generated on the host by `deploy/provision-mcp.py` and written to both env files.
 *
 * Why a MAC and not "trust it because it came from loopback": nginx is ALSO a loopback peer of the
 * engine, so a header a public client sent would arrive from 127.0.0.1 if nginx forwarded it. The
 * engine verifies the MAC, requires a loopback peer, and the public vhost strips these headers — three
 * independent conditions, any one of which stops a spoof.
 */

export {
  GATEWAY_HEADER,
  GATEWAY_MAX_SKEW_SECONDS,
  GATEWAY_REFUSAL,
  decodeGatewaySecret,
  gatewayHeaders,
  isLoopback,
  verifyGatewayHeaders,
  type GatewayInput,
  type GatewayRefusal,
  type GatewayVerdict,
} from '../../../engine/src/api/gateway.js';
