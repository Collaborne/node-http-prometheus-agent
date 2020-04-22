# node-http-prometheus-agent

Implementation of an http.Agent/https.Agent that exposes request metrics through [prom-client](https://github.com/siimon/prom-client).

## Installation

```sh
npm install --save node-http-prometheus-agent
npm install --save prom-client@^11
```

_Note: This library is only tested with prom-client 11.x, but a later version should work as well._

## Usage

The purpose of the this agent is watch requests going through the NodeJS HTTP/HTTPS client library, and expose the path and their status through the prom-client.

 1. Create a suitable `Counter` metric, for example for capturing requests from the AWS SDK:

    ```js
    const AWS_SDK_STATUS_CODE_METRIC = new Counter({
        help: 'Counter for the status codes for requests from the AWS SDK',
        labelNames: ['path', 'status', 'service'],
        name: `aws_sdk_http_status`,
    });
    ```

    The metric must minimally declare the `path` and `status` label names.

 2. Create the agent

    ```js
    import { defaultAgent } from 'https';
    import { wrapAgent } from 'node-http-prometheus-agent';

    const s3Agent = wrapAgent(defaultAgent, AWS_SDK_STATUS_CODE_METRIC, {
        extraLabels: {
            'service': 's3',
        },
    });
    ```

 3. Configure the consumer (the AWS SDK S3 client here) to use the agent for requests

    ```js
    import { S3 } from 'aws-sdk';

    const s3 = new S3({
        httpOptions: {
            agent: s3Agent,
        },
    });
    ```

 4. The metrics exposed by the prom-client library will now include the `aws_sdk_http_status` metric.

## Configuration

The `wrapAgent` takes the agent-to-be-wrapped, the metric, and an additional options object with these fields:

| Option         | Type                      | Default | Description
|----------------|---------------------------|---------|------------
| `extraLabels`  | `prom-client.labelValues` | none    | Set of labels that should be used together with the `path` and `status` labels when incrementing the counter value
| `normalizePath`| `(req: http.ClientRequest) => string` | Remove query strings and replace values through [url-value-parser](https://github.com/disjunction/url-value-parser) | A function that extracts and normalizes the path from the provided request

## License

```license
This software is licensed under the Apache 2 license, quoted below.

Copyright 2020-2020 Collaborne B.V. <http://github.com/Collaborne/>

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.
```
