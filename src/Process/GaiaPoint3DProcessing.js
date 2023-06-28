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
                    // TODO: Qui inserisco la creazione dell'elemento partendo dal buffer di punti
                    const config = {};
                    config.size = 1;
                    config.vertexColors = true;


                    if (geometry.inExtent.zoom > 16) {
                        config.size = 1.5;
                    } else if (geometry.inExtent.zoom > 18) {
                        config.size = 2;
                    } else if (geometry.inExtent.zoom > 19) {
                        config.size = 3;
                    }



                    // var material = new PointsMaterial(config);
                    // material = new THREE.PointsMaterial({ size: 0.5, vertexColors: true });
                    // material = new THREE.PointsMaterial({ color: 0x888888 });
                    var material = new THREE.PointsMaterial(config);
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
                    // points.extent = Extent.fromBox3(command.view.referenceCrs, node.bbox);
                    // points.userData.node = node;

                    // layer.object3d.add(points);
                    // node.link.push(points);

                    if (!node.parent) {
                        // TODO: Clean cache needs a refactory, because it isn't really efficient and used
                         points.visible = false;
                         ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer, points);
                         // console.log('Remove element ' + points);
                    } else {

                        /*
                        // Cerco il padre della tile e la segno da rimuovere
                        var rowFather = Math.floor(geometry.inExtent.row / 2);
                        var colFather = Math.floor(geometry.inExtent.col / 2);
                        var zoomFather = geometry.inExtent.zoom - 1;



                       for (var k = 0; k < layer.object3d.children.length; k++) {
                            const tilePoint = layer.object3d.children[k];
                            if ((tilePoint.geometry.inExtent.row === rowFather) && (tilePoint.geometry.inExtent.col === colFather) && (tilePoint.geometry.inExtent.zoom === zoomFather)) {
                                 tilePoint.visible = false;
                                 tilePoint.geometry.setDrawRange(0, 0);
                                 ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer, tilePoint);
                                // console.log('Remove element ' + tilePoint);
                            }
                        }
                        */

                        /*
                        // Provo a calcolare il budget quanto carico una tile
                        const listTile = layer.object3d.children.filter(obj => obj.geometry.inExtent !== undefined);
                        listTile.sort((a, b) => a.geometry.inExtent.zoom - b.geometry.inExtent.zoom);
                        // this.group.children.sort((p1, p2) => p2.userData.node.sse - p1.userData.node.sse);
                        this.pointBudget = 1000 * 1000 * 1.5;
                        let limitHit = false;
                        let numElementShow = 0;
                        let numElementTotal = 0;
                        for (const tilePoint of listTile) {
                            const count = tilePoint.geometry.numFeature;
                            numElementTotal += count;
                            if (limitHit || (numElementShow + count) > this.pointBudget) {
                                tilePoint.visible = false;
                                tilePoint.geometry.setDrawRange(0, 0);
                                limitHit = true;
                            } else {
                                tilePoint.geometry.setDrawRange(0, count);
                                numElementShow += count;
                            }
                        }


                        // layer.numElement = 'Point memory ' + numElementTotal + ' Point show ' + numElementShow + ' tile ' + layer.object3d.children.length;
                        */
                        // console.log(numElement);
                        layer.object3d.add(points);
                        // layer.numElement = 'Point memory ' + numElement + ' Point show ' + numElementShow + ' tile ' + layer.object3d.children.length;
                        node.link.push(points);
                    }


                    /*
                    featureMesh.as(context.view.referenceCrs);
                    featureMesh.meshes.position.z = geoidLayerIsVisible(layer.parent) ? node.geoidHeight : 0;
                    featureMesh.updateMatrixWorld();

                    if (layer.onMeshCreated) {
                        layer.onMeshCreated(featureMesh, context);
                    }

                    if (!node.parent) {
                        // TODO: Clean cache needs a refactory, because it isn't really efficient and used
                        ObjectRemovalHelper.removeChildrenAndCleanupRecursively(layer, featureMesh);
                    } else {
                        layer.object3d.add(featureMesh);
                        node.link.push(featureMesh);
                    }
                    featureMesh.layer = layer;
                    */
                } else {
                    // TODO: verify if it's possible the featureMesh is undefined.
                    node.layerUpdateState[layer.id].failure(1, true);
                }
            });
        },
        err => handlingError(err, node, layer, node.level, context.view));
    },
};
