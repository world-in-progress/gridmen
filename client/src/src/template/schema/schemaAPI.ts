import { baseResponse } from "../noodle/types"
import { SchemaData } from "./types"

const API_PREFIX = '/api/schema'

export const createSchema = async (schema: SchemaData): Promise<baseResponse> => {
    try {
        const url = API_PREFIX
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(schema),
        })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: baseResponse = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to create schema: ${error}`)
    }
}

export const getSchema = async (schemaName: string): Promise<SchemaData> => {
    try {
        const url = API_PREFIX + `/${schemaName}`
        const response = await fetch(url, { method: 'GET' })
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`)
        }
        const responseData: SchemaData = await response.json()
        return responseData
    } catch (error) {
        throw new Error(`Failed to get schema: ${error}`)
    }
}