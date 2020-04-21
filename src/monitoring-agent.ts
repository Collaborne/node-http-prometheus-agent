import { Agent, ClientRequestArgs, ClientRequest, IncomingMessage } from 'http';
import { format } from 'url';

import { getLogger } from '@log4js-node/log4js-api';
import { Counter, labelValues } from 'prom-client';

const logger = getLogger('nodejs-http-prometheus-agent');

function interceptResponse(req: ClientRequest, options: ClientRequestArgs, statusCodeMetric: Counter, extraLabels: labelValues) {
	logger.trace(`Request for ${format(options)}`);
	req.once('response', (res: IncomingMessage) => {
		statusCodeMetric.inc({
			...extraLabels,
			path: req.path,
			status: `${res.statusCode}`,
		});
	});
}

export interface WrapAgentOptions {
	extraLabels?: labelValues;
}

const DEFAULT_WRAP_AGENT_OPTIONS: Required<WrapAgentOptions> = {
	extraLabels: {},
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

	const {extraLabels} = {
		...DEFAULT_WRAP_AGENT_OPTIONS,
		...wrapAgentOptions,
	};

	const proxyHandler: ProxyHandler<T> = {
		get(target, key) {
			if (key === 'addRequest') {
				return (req: ClientRequest, options: ClientRequestArgs, ...args: any) => {
					interceptResponse(req, options, statusCodeMetric, extraLabels);
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
