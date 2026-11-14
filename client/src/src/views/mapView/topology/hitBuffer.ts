export default class HitBuffer {
    private _hits = new Set<number>()

    get size(): number { return this._hits.size }

    get all(): number[] {
        return [...this._hits].sort((a, b) => a - b)
    }

    set all(indices: number[]) {
        this._hits = new Set(indices)
    }

    get isHitting(): boolean {
        return this._hits.size > 0
    }

    isHit(index: number): boolean {
        return this._hits.has(index)
    }

    add(index: number): void {
        this._hits.add(index)
    }

    remove(storageId: number): void {
        this._hits.delete(storageId)
    }

    clear(): number[] {
        const all = this.all
        this._hits.clear()
        return all
    }
}
