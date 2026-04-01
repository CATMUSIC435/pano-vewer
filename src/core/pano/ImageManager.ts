import * as THREE from "three";

import { ImageDataTable, ImageDataTableRecord } from "src/core/indexeddb";

export class ImageManager {
    private loader: THREE.ImageLoader;

    enableCache = true;

    constructor() {
        this.loader = new THREE.ImageLoader();
    }

    private async setImageToInedxdb(record: ImageDataTableRecord) {
        try {
            await ImageDataTable.instance().save(record);
            console.log(`[Pano] Saved '${record.fileName}' to indexedDb`);
        } catch (error) {
            console.log(`[Pano] Failed to save '${record.fileName}' to indexedDb! ${error}`);
        }
    }

    private async getImageFromIndexdb(fileName: string): Promise<Blob | null> {
        const image = await ImageDataTable.instance().query(fileName);
        if (!image) {
            return null;
        }
        return image.data;
    }

    private async removeImageFromIndexdb(fileName: string) {
        await ImageDataTable.instance().delete(fileName);
    }

    private async clearImageFromIndexdb() {
        await ImageDataTable.instance().clearAll();
    }

    private async fetchAsBlob(url: string): Promise<Blob> {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`[ImageManager] Failed to fetch image ${url}`);
        }
        return res.blob();
    }

    private async decodeBlobToImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
        if (typeof createImageBitmap !== "undefined") {
            try {
                return await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "default" });
            } catch (e) {
                console.warn("[ImageManager] createImageBitmap failed, falling back to Image element.", e);
            }
        }

        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.src = objectUrl;
        return new Promise((resolve, reject) => {
            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = reject;
        });
    }

    async get(url: string) {
        let blob: Blob;
        if (this.enableCache && !url.startsWith("blob:") && !url.startsWith("data:")) {
            const cachedBlob = await this.getImageFromIndexdb(url);
            if (cachedBlob) {
                blob = cachedBlob;
            } else {
                blob = await this.fetchAsBlob(url);
                this.setImageToInedxdb({ fileName: url, data: blob });
            }
        } else {
            blob = await this.fetchAsBlob(url);
        }
        return this.decodeBlobToImage(blob);
    }

    async remove(url: string) {
        await this.removeImageFromIndexdb(url);
    }

    async clear() {
        await this.clearImageFromIndexdb();
    }

    public static getFileName(url: string) {
        const index = url.lastIndexOf("/");
        const fileName = url.substring(index + 1);
        return fileName;
    }

    destroy() {
        this.clear();
    }
}
