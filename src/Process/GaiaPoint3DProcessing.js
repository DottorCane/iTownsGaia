import LayerUpdateState from 'Layer/LayerUpdateState';
import ObjectRemovalHelper from 'Process/ObjectRemovalHelper';
import handlingError from 'Process/handlerNodeError';
import Coordinates from 'Core/Geographic/Coordinates';
import { geoidLayerIsVisible } from 'Layer/GeoidLayer';
import * as THREE from 'three';
import Extent from 'Core/Geographic/Extent';
//import PointsMaterial, { MODE } from 'Renderer/PointsMaterial';

const coord = new Coordinates('EPSG:4326', 0, 0, 0);
// Pre-allocato a livello di modulo per evitare allocazioni nel forEach delle tile
const _tileCenter = new THREE.Vector3();

export default {
    update(context, layer, node) {
        this.source = layer.source;
        // console.log(`update - context.scheduler.execute, ${layer.id}`);
        if (!node.parent && node.children.length) {
            // if node has been removed dispose three.js resource
            ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer, node);
            return;
        }
        if (!node.visible) {
            return;
        }

        if (node.layerUpdateState[layer.id] === undefined) {
            node.layerUpdateState[layer.id] = new LayerUpdateState();
        } else if (!node.layerUpdateState[layer.id].canTryUpdate()) {
            // toggle visibility features
            /*
            if (node.link!==null || node.link!==undefined){
                node.link.forEach((f) => {
                    if (f.layer?.id == layer.id) {
                        f.layer.object3d.add(f);
                        // f.meshes.position.z = geoidLayerIsVisible(layer.parent) ? node.geoidHeight : 0;
                        // f.meshes.updateMatrixWorld();
                    }
                });
            }*/

            return;
        }

        const extentsDestination = node.getExtentsByProjection(layer.source.crs) || [node.extent];

        const zoomDest = extentsDestination[0].zoom;

        // check if it's tile level is equal to display level layer.
        var res1 = !this.source.extentInsideLimit(node.extent, zoomDest);
        var res2 = !node.extent.isPointInside(layer.source.extent.center(coord));
        var res3 = zoomDest != layer.zoom.min;
        // console.log(`Update CHECK extent ${layer.id} ${res1} ${layer.source.isFileSource} ${res2}  ${res3} : Update CHECK extent ${zoomDest} layer.zoom.min ${layer.zoom.min} `);

        if (zoomDest > layer.zoom.max || zoomDest < layer.zoom.min) {
            // console.log(`NO noMoreUpdatePossible Zoom error, ${layer.id}`);
            node.layerUpdateState[layer.id].noMoreUpdatePossible();
            return;

        }
        if (!this.source.extentInsideLimit(node.extent, zoomDest) ||
        // In FileSource case, check if the feature center is in extent tile.
            (layer.source.isFileSource && !node.extent.isPointInside(layer.source.extent.center(coord)))) {
        // if not, there's not data to add at this tile.
            // console.log(`NO noMoreUpdatePossible, ${layer.id}`);
            node.layerUpdateState[layer.id].noMoreUpdatePossible();
            return;
        }
        // console.log(`YES UpdatePossible, ${layer.id}`);
        node.layerUpdateState[layer.id].newTry();

        // Calcola la priorità in base alla strategia configurata sul layer
        const mode = layer.priorityMode || 'distance';
        let priority = 1;
        if (mode === 'distance') {
            if (node.boundingVolume && node.boundingVolume.box) {
                const center = node.boundingVolume.box.getCenter(_tileCenter);
                const dist = context.camera.camera3D.position.distanceTo(center);
                priority = 1.0 / (dist + 1);
            } else if (node.obb) {
                const dist = context.camera.camera3D.position.distanceTo(node.obb.position);
                priority = 1.0 / (dist + 1);
            } else {
                priority = node.level; // fallback
            }
        } else if (mode === 'zoomAsc') {
            priority = 100 - node.level; // zoom basso prima (panoramica)
        } else if (mode === 'zoomDesc') {
            priority = node.level;       // zoom alto prima (dettaglio)
        } else { // fifo
            priority = 1;
        }

        const command = {
            layer,
            extentsSource: extentsDestination,
            view: context.view,
            threejsLayer: layer.threejsLayer,
            requester: node,
            priority,
        };
        // console.log(`context.scheduler.execute, ${command.layer.id}`);
        layer.stats.tilesLoading++;
        return context.scheduler.execute(command).then((featureMeshes) => {
            layer.stats.tilesLoading--;
            node.layerUpdateState[layer.id].noMoreUpdatePossible();

            featureMeshes.forEach((geometry) => {
                if (geometry) {
                    // Controllo se la tile è ancora visibile prima di processarla
                    if (geometry.boundingBox && context && context.camera) {
                        const bb = geometry.boundingBox;
                        _tileCenter.set(
                            (bb.max.x + bb.min.x) / 2,
                            (bb.max.y + bb.min.y) / 2,
                            (bb.max.z + bb.min.z) / 2
                        );
                        var distSq = context.camera.camera3D.position.distanceToSquared(_tileCenter);
                        var visible = context.camera.isBox3Visible(bb, layer.object3d.matrixWorld);
                        if (distSq < 10000) { visible = true; }
                        if (visible && layer.checkTileVisibilitySq) { visible = layer.checkTileVisibilitySq(geometry.inExtent.zoom, distSq); }
                        
                        if (!visible) {
                            geometry.dispose();
                            layer.stats.tilesDiscarded++;
                            return;
                        }
                    }

                    var key = geometry.inExtent.zoom + '_' + geometry.inExtent.row + '_' + geometry.inExtent.col;
                    geometry.inExtent.key = key;

                    // Cerco l'elemento con questa chiave
                    for (let i = 0; i < layer.object3d.children.length; i++) {
                        if (layer.object3d.children[i].geometry.inExtent.key === key ) {
                            return;
                        }
                    }

                    // Riutilizzo il materiale condiviso o ne creo uno se non disponibile (fallback)
                    var material = layer._sharedPointsMaterial;
                    if (!material) {
                        const config = {};
                        config.size = layer.pointSize;
                        config.vertexColors = true;
                        material = new THREE.PointsMaterial(config);
                        if (layer.opacity < 1){
                            material.opacity = layer.opacity;
                            material.transparent = true;
                        }
                    }

                    const points = new THREE.Points(geometry, material);
                    points.zoom = geometry.inExtent.zoom;
                    points.lastTimeVisible = 0;

                    var pointFinal;
                    if (layer.offset){
                        pointFinal = points.geometry.boundingBox.min.clone().add(layer.offset);
                    }else{
                        pointFinal = points.geometry.boundingBox.min.clone()
                    }

                    points.position.copy(pointFinal);


                    var scaleVector = new THREE.Vector3(1, 1, 1);
                    points.scale.copy(scaleVector);
                    points.updateMatrixWorld();

                    // addPickingAttribute(points);
                    points.frustumCulled = false;
                    points.matrixAutoUpdate = false;


                    /*
                    // Per il momento i dati arrivano con le coordinate giuste
                    if (!layer.isEntwinePointTileLayer) {
                        points.position.copy(node.bbox.min);
                        points.scale.copy(layer.scale);
                    }
                    */
                    points.updateMatrix();
                    // points.tightbbox = geometry.boundingBox.applyMatrix4(points.matrix);
                    points.layers.set(layer.threejsLayer);
                    points.layer = layer;

                    if (!node.parent) {
                        // TODO: Clean cache needs a refactory, because it isn't really efficient and used
                         points.visible = false;
                         ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer, points);
                    } else {
                        layer.object3d.add(points);
                        //node.link.push(points);
                    }
                } else {
                    // TODO: verify if it's possible the featureMesh is undefined.
                    node.layerUpdateState[layer.id].failure(1, true);
                }
            });
        },
        (err) => {
            layer.stats.tilesLoading--;
            handlingError(err, node, layer, node.level, context.view);
        });
    },
};
