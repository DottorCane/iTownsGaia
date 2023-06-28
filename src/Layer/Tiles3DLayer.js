import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import { init3dTilesLayer, pre3dTilesUpdate, process3dTilesNode } from 'Process/Tiles3DProcessing';
import C3DTileset from 'Core/3DTiles/C3DTileset';
import C3DTExtensions from 'Core/3DTiles/C3DTExtensions';

const update = process3dTilesNode();

// Esperimento che direi non è andato a buon fine...

class Tiles3DLayer extends GeometryLayer {
    /**
     * Constructs a new instance of 3d tiles layer.
     * @constructor
     * @extends GeometryLayer
     *
     * @example
     * // Create a new Layer 3d-tiles For DiscreteLOD
     * const l3dt = new C3DTilesLayer('3dtiles', {
     *      name: '3dtl',
     *      source: new C3DTilesSource({
     *           url: 'https://tileset.json'
     *      })
     * }, view);
     * View.prototype.addLayer.call(view, l3dt);
     *
     * @param      {string}  id - The id of the layer, that should be unique.
     *     It is not mandatory, but an error will be emitted if this layer is
     *     added a
     * {@link View} that already has a layer going by that id.
     * @param      {object}  config   configuration, all elements in it
     * will be merged as is in the layer.
     * @param {C3TilesSource} config.source The source of 3d Tiles.
     *
     * name.
     * @param {Number} [config.sseThreshold=16] The [Screen Space Error](https://github.com/CesiumGS/3d-tiles/blob/main/specification/README.md#geometric-error)
     * threshold at which child nodes of the current node will be loaded and added to the scene.
     * @param {Number} [config.cleanupDelay=1000] The time (in ms) after which a tile content (and its children) are
     * removed from the scene.
     * @param {Function} [config.onTileContentLoaded] Callback executed when the content of a tile is loaded.
     * @param {Boolean|Material} [config.overrideMaterials='false'] option to override the materials of all the layer's
     * objects. If true, a threejs [MeshBasicMaterial](https://threejs.org/docs/index.html?q=meshbasic#api/en/materials/MeshBasicMaterial)
     * is set up. config.overrideMaterials can also be a threejs [Material](https://threejs.org/docs/index.html?q=material#api/en/materials/Material)
     * in which case it will be used as the material for all objects of the layer.
     * @param {C3DTExtensions} [config.registeredExtensions] 3D Tiles extensions managers registered for this tileset.
     * @param  {View}  view  The view
     */
    constructor(id, config, view) {
        super(id, new THREE.Group(), { source: config.source });
        // this.isC3DTilesLayer = true;
        this.isTiles3DLayer = true;
        // this.sseThreshold = config.sseThreshold || 16;
        // this.cleanupDelay = config.cleanupDelay || 1000;
        // this.onTileContentLoaded = config.onTileContentLoaded || (() => {});
        // this.protocol = '3d-tiles';
        this.protocol = 'tiles3d';
        this.overrideMaterials = config.overrideMaterials ?? false;
        this.name = config.name;
        // this.registeredExtensions = config.registeredExtensions || new C3DTExtensions();

        this._cleanableTiles = [];

        // const resolve = this.addInitializationStep();

        /*
        this.source.whenReady.then((tileset) => {
            this.tileset = new C3DTileset(tileset, this.source.baseUrl, this.registeredExtensions);
            // Verify that extensions of the tileset have been registered in the layer
            if (this.tileset.extensionsUsed) {
                for (const extensionUsed of this.tileset.extensionsUsed) {
                    // if current extension is not registered
                    if (!this.registeredExtensions.isExtensionRegistered(extensionUsed)) {
                        // if it is required to load the tileset
                        if (this.tileset.extensionsRequired &&
                            this.tileset.extensionsRequired.includes(extensionUsed)) {
                            console.error(
                                `3D Tiles tileset required extension "${extensionUsed}" must be registered to the 3D Tiles layer of iTowns to be parsed and used.`);
                        } else {
                            console.warn(
                                `3D Tiles tileset used extension "${extensionUsed}" must be registered to the 3D Tiles layer of iTowns to be parsed and used.`);
                        }
                    }
                }
            }
            // TODO: Move all init3dTilesLayer code to constructor
            init3dTilesLayer(view, view.mainLoop.scheduler, this, tileset.root).then(resolve);
        });
        */
    }

    preUpdate() {
        return pre3dTilesUpdate.bind(this)();
    }

    update(context, layer, node) {
        // return update(context, layer, node);
       var crs = 'TMS:3857';
       // var extentsDestination = node.getExtentsByProjection(layer.crs);
       var extentsDestination = node.getExtentsByProjection(crs);
       var zoom = extentsDestination[0].zoom;
       // console.log(extentsDestination[0]);
       var scale = context.view.getScale();
       var zetaLevel = this.getZetaLevel(scale);
       var tileResult = this.getTile(context.camera.camera3D.position.z, context.camera.camera3D.position.y, zetaLevel);
       // console.log(' scala ' + context.view.getScale() + ' zetaLevel ' + zetaLevel);
       // console.log('X ' + context.camera.camera3D.position.x + ' Y ' + context.camera.camera3D.position.y + ' Z ' + context.camera.camera3D.position.z + ' zetaLevel ' + zetaLevel);
       var url = this.source.url;
        url = url.replace('{x}', tileResult.x);
        url = url.replace('{y}', tileResult.y);
        url = url.replace('{z}', tileResult.z);
        // console.log(url);
       return null;
    }

    // Al momento uso un metodo ottenuto facendo varie prove
    getZetaLevel(scale) {

        // Scale 100 number = 0,0047541148349641155;
        var magicNumber = 0.475411483496411;
        // Scala 20 corrisponde a 564 di scale
        if (scale < 0.000000001) {
            return 20;
        }
        if (scale > magicNumber) {
            return 20;
        }
        var scaleValueCalc  = (magicNumber / scale);
        var calc2 = scaleValueCalc;
        var scaleLevel = 564;
        var zetaLevel = 20;
        while ((scaleValueCalc > scaleLevel) && (zetaLevel > 0)) {
            scaleLevel *= 2;
            zetaLevel -=  1;
        }
        zetaLevel -= 1;
        return zetaLevel;
    }

    getTile(x, y, level) {
        var lengthFix = 20037508;
        var lengthX = lengthFix * 2;
        var lengthY = lengthFix * 2;
        var minX = -lengthFix;
        var minY = -lengthFix;
        var division = 2 ** level;
        var lengthTile = lengthX / division;
        x = lengthFix + x;
        y = lengthFix + y;
        var divX = x / lengthTile;
        var divY = y / lengthTile;
        // console.log(divX + ' ' + divY);
        divX = Math.ceil(divX);
        divY = Math.ceil(divY);
        // console.log(divX + ' ' + divY);
        var result = { x: divX, y: divY, z: level };
        return result;
    }

    getObjectToUpdateForAttachedLayers(meta) {
        if (meta.content) {
            const result = [];
            meta.content.traverse((obj) => {
                if (obj.isObject3D && obj.material && obj.layer == meta.layer) {
                    result.push(obj);
                }
            });
            const p = meta.parent;
            if (p && p.content) {
                return {
                    elements: result,
                    parent: p.content,
                };
            } else {
                return {
                    elements: result,
                };
            }
        }
    }

    /**
     * Finds the batch table of an object in a 3D Tiles layer. This is
     * for instance needed when picking because we pick the geometric
     * object which is not at the same level in the layer structure as
     * the batch table. More details here on itowns internal
     * organization of 3DTiles:
     *  https://github.com/MEPP-team/RICT/blob/master/Doc/iTowns/Doc.md#itowns-internal-organisation-of-3d-tiles-data
     * @param {THREE.Object3D} object - a 3D geometric object
     * @returns {C3DTBatchTable} - the batch table of the object
     */
    findBatchTable(object) {
        if (object.batchTable) {
            return object.batchTable;
        }
        if (object.parent) {
            return this.findBatchTable(object.parent);
        }
    }

    /**
     * Gets semantic information from batch table and batch table extensions
     * of an intersected feature.
     * @param {Array} intersects - @return An array containing all
     * targets picked under specified coordinates. Intersects can be
     * computed with view.pickObjectsAt(..). See fillHTMLWithPickingInfo()
     * in 3dTilesHelper.js for an example.
     * @returns {Object} - an object containing the batch id, the
     * information from the batch table and from the extension of the batch
     * table for an intersected feature.
     */
    getInfoFromIntersectObject(intersects) {
        const resultInfo = {};

        let batchID = -1;
        let batchTable = {};
        // First, we get the ID and the batch table of the intersected object.
        // (the semantic information about a feature is located in its batch
        // table (see 3D Tiles specification).
        for (let i = 0; i < intersects.length; i++) {
            // interAttributes are glTF attributes of b3dm tiles (i.e.
            // position, normal, batch id)
            const interAttributes = intersects[i].object.geometry.attributes;
            if (interAttributes && interAttributes._BATCHID) {
                // face is a Face3 object of THREE which is a
                // triangular face. face.a is its first vertex
                const vertex = intersects[i].face.a;
                // get batch id of the face
                batchID = interAttributes._BATCHID.array[vertex];
                batchTable = this.findBatchTable(intersects[i].object);
                break;
            }
        }

        if (batchID === -1) {
            return;
        }

        resultInfo.batchID = batchID;
        // get information from batch table (including from its extension)
        Object.assign(resultInfo, batchTable.getInfoById(batchID));

        return resultInfo;
    }
}

export default Tiles3DLayer;
