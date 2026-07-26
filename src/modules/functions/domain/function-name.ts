import { FunctionValidationError } from './function.errors';

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

export class FunctionName {
  private constructor(readonly value: string) {}

  static create(value: string): FunctionName {
    if (value.length < 1 || value.length > 63 || !DNS_LABEL.test(value)) {
      throw new FunctionValidationError(
        'name must be a lowercase Kubernetes DNS label with at most 63 characters',
      );
    }

    return new FunctionName(value);
  }

  toString(): string {
    return this.value;
  }
}
