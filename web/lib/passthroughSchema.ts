import type { StandardSchemaV1 } from "@standard-schema/spec";

export function passthrough<T>(): StandardSchemaV1<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "open-agent",
      validate: (value) => ({ value: value as T }),
    },
  };
}
