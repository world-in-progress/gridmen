import DefaultTemplate from "@/template/default/default"
import SchemaTemplate from "@/template/schema/schema"
import { ITemplate } from "@/template/iTemplate"

const defaultTemplate = new DefaultTemplate()
const schemaTemplate = new SchemaTemplate()

const _TEMPLATE_REGISTRY: Record<string, ITemplate> = {
    [defaultTemplate.templateName]: defaultTemplate,
    [schemaTemplate.templateName]: schemaTemplate
}

export const TEMPLATE_REGISTRY = new Proxy(_TEMPLATE_REGISTRY, {
    get(target, prop: string) {
        // Always return a template instance; fallback to the default template instance
        return target[prop] || defaultTemplate
    }
})

