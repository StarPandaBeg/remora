export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export interface JsonObject {
    [key: string]: JsonValue
}
