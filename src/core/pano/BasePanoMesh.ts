import _ from "lodash";
import * as THREE from "three";

import type { ImageManager } from "./ImageManager";

/**
 * The base class of vr mesh.
 */
export class BasePanoMesh extends THREE.Group {
    protected textureLoader = new THREE.TextureLoader();
    protected imageManager: ImageManager;
    protected images: string[];
    protected mesh?: THREE.Object3D; // the box that attaches images
    protected thumbnailImages?: string[];
    protected thumbnailMesh?: THREE.Mesh; // the box that attaches thumbnail images
    protected size: number;
    private fadingInInterval?: number;
    private fadingOutInterval?: number;

    render?: () => void;
    private enableCache = false;

    constructor(imgMgr: ImageManager, images: string[], thumbnailImages?: string[], size = 10) {
        super();

        this.imageManager = imgMgr;

        this.images = images;
        this.thumbnailImages = thumbnailImages;
        this.size = size;

        this.mesh = new THREE.Mesh(); // Variables must be initialized in the constructor
    }

    /**
     * Fades in by changing its opacity
     */
    fadeIn(durationInMs = 1000) {
        let materials = this.getMaterials();
        if (Array.isArray(materials) && materials.length > 0) {
            materials.forEach((m) => (m.opacity = 0));
        } else {
            // no material, just make it visible and return
            this.visible = true;
            return;
        }

        this.visible = true;
        this.clearFading(); // just in case there is existing fading interval, stop it
        this.renderOrder = Infinity;

        const startTime = performance.now();

        const animateFadeIn = (time: number) => {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / durationInMs, 1);

            const newMaterials = this.getMaterials();
            if (!this.materialsEqual(materials, newMaterials)) {
                materials = newMaterials;
            }
            if (materials.length > 0) {
                materials.forEach((m) => (m.opacity = progress));
            }
            this.render?.();

            // continue frame loop until progress is over
            if (progress < 1) {
                this.fadingInInterval = requestAnimationFrame(animateFadeIn);
            } else {
                this.clearFading();
            }
        };
        this.fadingInInterval = requestAnimationFrame(animateFadeIn);
    }

    protected materialsEqual(mat1: THREE.Material | THREE.Material[], mat2: THREE.Material | THREE.Material[]) {
        return _.isEqualWith(mat1, mat2, (m1, m2) => {
            if (Array.isArray(m1) && Array.isArray(m2)) {
                return;
            }
            return m1.id === m2.id;
        });
    }

    /**
     * Fades out by changing its opacity.
     * In the meantime, will dynamically change its scale. We do this because there is
     * bug in threejs that when two or more pictures are transparent, it may render improperly!
     */
    fadeOut(durationInMs = 1000) {
        let materials = this.getMaterials();

        const startScale = 2; // make the box larger first to avoid overlapping with another box
        const endScale = 3;

        this.clearFading(); // just in case there is existing fading interval, stop it
        this.scale.set(startScale, startScale, startScale);
        this.renderOrder = 0;

        const startTime = performance.now();

        const animateFadeOut = (time: number) => {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / durationInMs, 1);

            const currentScale = startScale + (endScale - startScale) * progress;
            this.scale.set(currentScale, currentScale, currentScale);

            const newMaterials = this.getMaterials();
            if (!this.materialsEqual(materials, newMaterials)) {
                materials = newMaterials;
            }
            if (materials.length > 0) {
                materials.forEach((m) => (m.opacity = 1 - progress));
            }
            this.render?.();

            if (progress < 1) {
                this.fadingOutInterval = requestAnimationFrame(animateFadeOut);
            } else {
                this.clearFading();
                this.enableCache && this.destroy();
            }
        };
        this.fadingOutInterval = requestAnimationFrame(animateFadeOut);
    }

    /**
     * Clears existing fadeIn/fadeOut intervals if any
     */
    private clearFading() {
        const materials = this.getMaterials();

        if (this.fadingInInterval !== undefined) {
            cancelAnimationFrame(this.fadingInInterval);
            this.fadingInInterval = undefined;
            this.visible = true; // display it directly without fading any longer
            materials.forEach((mat) => (mat.opacity = 1)); // revert opacity to 1
        }

        if (this.fadingOutInterval !== undefined) {
            cancelAnimationFrame(this.fadingOutInterval);
            this.fadingOutInterval = undefined;
            this.visible = false; // hide it directly without fading any longer
            materials.forEach((mat) => (mat.opacity = 1)); // revert opacity to 1
            this.scale.set(1, 1, 1);
        }
    }

    protected getMaterials() {
        let mesh = this.thumbnailMesh as THREE.Mesh;
        if (!mesh) {
            mesh = this.mesh as THREE.Mesh;
        }
        const materials = [];
        if (Array.isArray(mesh.material)) {
            materials.push(...mesh.material);
        } else if (mesh.material) {
            materials.push(mesh.material);
        }
        return materials;
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    protected create() {}

    protected async createThumbnailMesh(size: number) {
        if (!this.thumbnailImages || this.thumbnailImages.length != 6) {
            return;
        }

        this.thumbnailMesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size));
        this.thumbnailMesh.geometry.scale(1, 1, -1);

        const textures = await this.loadTexturesAsync(this.thumbnailImages, false);
        const materials = textures.map((texture) => new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide, transparent: true }));

        if (this.thumbnailMesh) {
            // Considers that it may have been removed asynchronously
            this.thumbnailMesh.material = materials;
            this.add(this.thumbnailMesh);
        }
    }

    protected async loadTexturesAsync(images: string[], isCache = true) {
        return Promise.all(
            images.map(async (url) => {
                const prevCacheState = this.imageManager.enableCache;
                if (!isCache) {
                    this.imageManager.enableCache = false;
                }
                try {
                    const image = await this.imageManager.get(url);
                    const texture = new THREE.Texture(image);
                    // Disable automatic texture flip for ImageBitmap to avoid double-flip or software flip
                    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
                        texture.flipY = false;
                    }
                    texture.needsUpdate = true;
                    texture.colorSpace = THREE.SRGBColorSpace;

                    // Perf check: Do not use expensive Mipmapping and Filters for inside panoramas
                    texture.generateMipmaps = false;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    // Bật lại cache
                    this.imageManager.enableCache = prevCacheState;
                    return texture;
                } catch (e) {
                    this.imageManager.enableCache = prevCacheState;
                    throw e;
                }
            })
        );
    }

    setCacheEnabled(enable: boolean) {
        this.enableCache = enable;
    }

    destroyMesh(mesh: THREE.Mesh) {
        this.remove(mesh);
        mesh.clear();
        mesh.geometry.dispose();
        if (!Array.isArray(mesh.material)) {
            (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
            mesh.material.dispose();
        } else {
            mesh.material.forEach((m) => {
                (m as THREE.MeshBasicMaterial).map?.dispose();
                m.dispose();
            });
        }
    }

    destroy() {
        this.clearFading();
        this.images = [];
        this.thumbnailImages = undefined;
        this.removeFromParent();

        if (this.thumbnailMesh) {
            this.destroyMesh(this.thumbnailMesh);
            this.thumbnailMesh = undefined;
        }

        if (!this.mesh) {
            return;
        }
        if (this.mesh instanceof THREE.Mesh) {
            this.destroyMesh(this.mesh);
        } else {
            this.mesh.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    this.destroyMesh(child);
                }
            });
        }
        this.mesh = undefined;
    }
}
