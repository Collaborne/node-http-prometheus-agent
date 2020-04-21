import { Agent, ClientRequestArgs, ClientRequest, IncomingMessage } from 'http';
import { format } from 'url';

import { getLogger } from '@log4js-node/log4js-api';

import UrlValueParser from 'url-value-parser';
import { Counter, labelValues } from 'prom-client';

const logger = getLogger('nodejs-http-prometheus-agent');

function interceptResponse(req: ClientRequest, options: ClientRequestArgs, statusCodeMetric: Counter, extraLabels: labelValues, normalizePath: (req: ClientRequest) => string) {
	logger.trace(`Request for ${format(options)}`);
	req.once('response', (res: IncomingMessage) => {
		statusCodeMetric.inc({
			...extraLabels,
			path: normalizePath(req),
			status: `${res.statusCode}`,
		});
	});
}

export interface WrapAgentOptions {
	extraLabels?: labelValues;
	normalizePath?(req: ClientRequest): string;
}

const DEFAULT_URL_VALUE_PARSER = new UrlValueParser();
const DEFAULT_WRAP_AGENT_OPTIONS: Required<WrapAgentOptions> = {
	extraLabels: {},
	normalizePath(req) {
		return DEFAULT_URL_VALUE_PARSER.replacePathValues(req.path, '#val');
	}
};

export function wrapAgent<T extends Agent = Agent>(
	agent: T,
	statusCodeMetric: Counter,
	wrapAgentOptions?: WrapAgentOptions): T {

	const agentPrototype = Object.getPrototypeOf(agent);
	if (!('addRequest' in agentPrototype)) {
		// NodeJS internally mandates the same, see https://github.com/nodejs/node/blob/v12.15.0/lib/_http_client.js#L124-L128
		throw new Error('Unsupported Agent: No "addRequest" function in provided agent');
	}

	const {extraLabels, normalizePath} = {
		...DEFAULT_WRAP_AGENT_OPTIONS,
		...wrapAgentOptions,
	};

	const proxyHandler: ProxyHandler<T> = {
		get(target, key) {
			if (key === 'addRequest') {
				return (req: ClientRequest, options: ClientRequestArgs, ...args: any) => {
					interceptResponse(req, options, statusCodeMetric, extraLabels, normalizePath);
					return agentPrototype.addRequest.call(target, req, options, ...args);
				}
			} else if (key in target) {
				return (target as any)[key];
			}
			return undefined;
		}
	};

	return new Proxy(agent, proxyHandler);
}
