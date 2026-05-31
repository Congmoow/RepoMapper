export class RepoMapperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoMapperError';
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
