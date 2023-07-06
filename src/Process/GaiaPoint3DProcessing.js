import LayerUpdateState from 'Layer/LayerUpdateState';
import ObjectRemovalHelper from 'Process/ObjectRemovalHelper';
import handlingError from 'Process/handlerNodeError';
import Coordinates from 'Core/Geographic/Coordinates';
import { geoidLayerIsVisible } from 'Layer/GeoidLayer';
import * as THREE from 'three';
import Extent from 'Core/Geographic/Extent';
import PointsMaterial, { MODE } from 'Renderer/PointsMaterial';

const coord = new Coordinates('EPSG:4326', 0, 0, 0);

export default {
    update(context, layer, node) {
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

            node.link.forEach((f) => {
                if (f.layer?.id == layer.id) {
                    f.layer.object3d.add(f);
                    // f.meshes.position.z = geoidLayerIsVisible(layer.parent) ? node.geoidHeight : 0;
                    // f.meshes.updateMatrixWorld();
                }
            });

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

        const command = {
            layer,
            extentsSource: extentsDestination,
            view: context.view,
            threejsLayer: layer.threejsLayer,
            requester: node,
        };
        // console.log(`context.scheduler.execute, ${command.layer.id}`);
        return context.scheduler.execute(command).then((featureMeshes) => {
            node.layerUpdateState[layer.id].noMoreUpdatePossible();

            featureMeshes.forEach((geometry) => {
                if (geometry) {
                    const config = {};
                    config.size = layer.pointSize;
                    config.vertexColors = true;

                    var key = geometry.inExtent.zoom + '_' + geometry.inExtent.row + '_' + geometry.inExtent.col;
                    geometry.inExtent.key = key;

                    //Cerco che l'elemento con questa chiave. Se è già presente nel layer non lo inserisco ancora
                    for (const tilePoint of layer.object3d.children) {
                        if (tilePoint.geometry.inExtent.key === key ){
                            return;
                        }
                    }

                    var material = new THREE.PointsMaterial(config);
                    material.opacity = this.pointSize;
                    material.transparent = true;
                    // const material = new THREE.PointsMaterial({ color: 0x000000 });
                    const points = new THREE.Points(geometry, material);
                    points.zoom = geometry.inExtent.zoom;
                    points.lastTimeVisible = 0;

                    points.position.copy(points.geometry.boundingBox.min);
                    var scaleVector = new THREE.Vector3(1, 1, 1);
                    points.scale.copy(scaleVector);

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
                        node.link.push(points);
                    }
                } else {
                    // TODO: verify if it's possible the featureMesh is undefined.
                    node.layerUpdateState[layer.id].failure(1, true);
                }
            });
        },
        err => handlingError(err, node, layer, node.level, context.view));
    },
};
