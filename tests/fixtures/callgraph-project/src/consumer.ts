import { client, request as sendRequest } from './api';

export function load(): string {
  return sendRequest() + client.get();
}
