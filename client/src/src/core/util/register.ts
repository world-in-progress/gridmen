import { Class, Klass } from '../types'
import BoundingBox2D, { boundingBox2D } from './boundingBox2D'

export type Registry = {
    [ key: string ]: {
        klass: Klass
        omit: ReadonlyArray<string>
    }
}

export type RegisterOptions<T> = {
    omit?: ReadonlyArray<keyof T>
}

const registry: Registry = {}

export function register<T>(klass: Class<T>, name: string, options: RegisterOptions<T> = {}) {
    if (registry[name]) return

    Object.defineProperty(klass, '_classRegistryKey', {
        value: name,
        writable: false
    })

    registry[name] = {
        klass,
        omit: options.omit || []
    } as unknown as Registry[string]
}

export default registry

// Register //////////////////////////////////////////////////////////////////////////////////////////////////////

register(Error, 'Error')
register(Object, 'Object')
register(BoundingBox2D, 'BoundingBox2D')
