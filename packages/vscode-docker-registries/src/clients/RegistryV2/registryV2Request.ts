/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuthenticationProvider } from '../../contracts/AuthenticationProvider';
import { isBasicOAuthProvider } from '../../auth/BasicOAuthProvider';
import { RequestLike, httpRequest } from '../../utils/httpRequest';
import { HttpErrorResponse } from '../../utils/errors';

export interface RegistryV2RequestOptions {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    requestUri: vscode.Uri;
    query?: Record<string, string>;
    scopes: string[];
    headers?: Record<string, string>;
    throwOnFailure?: boolean;
    authenticationProvider: AuthenticationProvider<vscode.AuthenticationGetSessionOptions>;
    sessionOptions?: vscode.AuthenticationGetSessionOptions;
}

export interface RegistryV2Response<T> {
    status: number;
    statusText: string;
    succeeded: boolean;
    uri: vscode.Uri;
    headers: Record<string, string>;
    body: T | undefined;
}

export async function registryV2Request<T>(options: RegistryV2RequestOptions): Promise<RegistryV2Response<T>> {
    if (isBasicOAuthProvider(options.authenticationProvider) && !options.authenticationProvider.didFallback) {
        const result = await registryV2RequestInternal<T>({ ...options, throwOnFailure: false });
        if (result.succeeded) {
            return result;
        } else if (result.status === 401 && result.headers['www-authenticate']) {
            options.authenticationProvider.fallback(result.headers['www-authenticate']);
        } else {
            throw new HttpErrorResponse(options.requestUri.toString(), result.status, result.statusText);
        }
    }

    return await registryV2RequestInternal<T>(options);
}

async function registryV2RequestInternal<T>(options: RegistryV2RequestOptions): Promise<RegistryV2Response<T>> {
    const query = new URLSearchParams(options.query);
    const uri = options.requestUri.with({ query: query.toString() });

    const request: RequestLike = {
        headers: {
            accept: 'application/json',
            ...options.headers
        },
        method: options.method,
    };

    const auth = await options.authenticationProvider.getSession(options.scopes, options.sessionOptions);
    request.headers['Authorization'] = `${auth.type} ${auth.accessToken}`;

    const response = await httpRequest(uri.toString(true), request, options.throwOnFailure);

    return {
        status: response.status,
        statusText: response.statusText,
        succeeded: response.succeeded,
        uri: uri,
        headers: response.headers,
        body: response.succeeded && (parseInt(response.headers['content-length']) || response.headers['transfer-encoding'] === 'chunked') ? await response.json() as T : undefined,
    };
}
