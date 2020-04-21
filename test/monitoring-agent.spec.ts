import { expect } from 'chai';
import type { Suite } from 'mocha';
import 'mocha';

import type { IncomingMessage, RequestListener } from 'http';
import http from 'http';
import type { RequestOptions } from 'https';
import https from 'https';

import { register, Counter, labelValues } from 'prom-client';
import forge from 'node-forge';

import { wrapAgent } from '../src/monitoring-agent';

function createTestHttpsServer(handler?: RequestListener): https.Server {
	// Adapted from https://github.com/digitalbazaar/forge/blob/master/examples/create-cert.js
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
	const attrs = [{
		name: 'commonName',
		value: 'localhost'
	}];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{
			name: 'basicConstraints',
			cA: true
		}, {
			name: 'keyUsage',
			keyCertSign: true,
			digitalSignature: true,
			nonRepudiation: true,
			keyEncipherment: true,
			dataEncipherment: true
		}, {
			name: 'extKeyUsage',
			serverAuth: true,
		}, {
			name: 'nsCertType',
			server: true,
		}, {
			name: 'subjectAltName',
			altNames: [
				{
					type: 6, // URI
					value: 'https://localhost'
				}, {
					type: 7, // IP
					ip: '127.0.0.1'
				}
			]
		}, {
			name: 'subjectKeyIdentifier'
		}
	]);
	cert.sign(keys.privateKey);

	const pem = {
		privateKey: forge.pki.privateKeyToPem(keys.privateKey),
		publicKey: forge.pki.publicKeyToPem(keys.publicKey),
		certificate: forge.pki.certificateToPem(cert)
	};
	return https.createServer({
		key: pem.privateKey,
		cert: pem.certificate,
	}, handler);
}

function getCounterValue(metric: Counter, labels: labelValues = {}) {
	return (metric as any).get()
		.values
		.find((value: {labels: labelValues}) => Object.entries(labels).every(([k, v]) => value.labels[k] === v));
}

function mockServer<T extends http.Server>(protocol: string, createServer: (handler?: RequestListener) => T): (handler: RequestListener, host?: string) => Promise<{baseUrl: string, finish: () => void}> {
	return (handler: RequestListener, host?: string) => {
		return new Promise((resolve, reject) => {
			const server = createServer(handler);
			const listener = server.listen(0, host, () => {
				const address = listener.address()!;
				if (typeof address !== 'string') {
					let baseUrl;
					switch (address.family) {
						case 'IPv4':
							baseUrl = `${protocol}//${address.address}:${address.port}`;
							break;
						case 'IPv6':
							baseUrl = `${protocol}//[${address.address}]:${address.port}`;
							break;
					}
					if (baseUrl) {
						resolve({baseUrl, finish: () => server.close()});
						return;
					}
				}
				// Likely a UNIX domain socket, and not what the caller wants.
				reject(new Error(`Unexpected address ${address}`));
			});
		});
	}
}

const PROTOCOLS = [
	{
		protocol: 'http:',
		agent: http.globalAgent,
		request: http.request,
		createServer: mockServer('http:', http.createServer),
	},
	{
		protocol: 'https:',
		agent: new https.Agent({rejectUnauthorized: false}),
		request: https.request,
		createServer: mockServer('https:', createTestHttpsServer),
	},
];

const FAMILY_EXAMPLES = {
	'IPv6': '::1',
	'IPv4': '127.0.0.1',
};

function travisAndIPv6(family: string) {
	// Travis is odd when it comes to IPv6 addresses, so skip everything there.
	return process.env.TRAVIS === 'true' && family === 'IPv6';
}

function skipIf(condition: boolean, title: string, fn: (this: Suite) => void) {
	if (condition) {
		describe.skip(title, fn);
	} else {
		describe(title, fn);
	}
}

describe('monitoring-agent', () => {
	let metric: Counter;
	beforeEach(() => {
		metric = new Counter({
			help: 'test',
			name: 'test',
			labelNames: ['label1', 'label2', 'path', 'status'],
		});
	});
	afterEach(() => {
		register.clear();
	});

	Object.entries(FAMILY_EXAMPLES).forEach(([family, host]) => {
		skipIf(travisAndIPv6(family), `${family} support (test host ${host})`, () => {
			PROTOCOLS.forEach(({protocol, request, agent, createServer}) => {
				function requestUrl(url: string, options: RequestOptions = {}): Promise<IncomingMessage> {
					return new Promise(resolve => {
						const req = request(url, options, (res: IncomingMessage) => {
							resolve(res);
						});
						req.end();
					});
				}

				it(`intercepts successful ${protocol} requests`, async () => {
					const {baseUrl, finish} = await createServer((req, res) => {
						res.statusCode = 200;
						res.end();
					}, host);
					try {
						await requestUrl(baseUrl, {agent: wrapAgent(agent, metric)});
						expect(getCounterValue(metric, {status: '200'}).value).to.be.equal(1);
					} finally {
						finish();
					}
				});
				it(`intercepts failing ${protocol} requests`, async () => {
					const {baseUrl, finish} = await createServer((req, res) => {
						res.statusCode = 500;
						res.end();
					}, host);
					try {
						await requestUrl(baseUrl, {agent: wrapAgent(agent, metric)});
						expect(getCounterValue(metric, {status: '500'}).value).to.be.equal(1);
					} finally {
						finish();
					}
				});
				it(`adds path labels in ${protocol} requests`, async () => {
					const {baseUrl, finish} = await createServer((req, res) => {
						res.statusCode = 200;
						res.end();
					}, host);
					try {
						await requestUrl(`${baseUrl}/path`, {agent: wrapAgent(agent, metric)});
						expect(getCounterValue(metric, {status: '200'}).labels).to.deep.include({path: '/path'});
					} finally {
						finish();
					}
				});
				it(`adds extra labels in ${protocol} requests`, async () => {
					const {baseUrl, finish} = await createServer((req, res) => {
						res.statusCode = 200;
						res.end();
					}, host);
					try {
						await requestUrl(baseUrl, {agent: wrapAgent(agent, metric, {label1: 'dummy'})});
						expect(getCounterValue(metric, {status: '200', label1: 'dummy'}).value).to.be.equal(1);
					} finally {
						finish();
					}
				});
			});
		});
	});
});
