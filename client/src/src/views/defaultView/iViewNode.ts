export interface ViewDescription {
    semanticPath: string
    children: string[]
}

export interface IView extends ViewDescription {
    name: string

    viewModelFactory(): Function
}