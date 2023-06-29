import { Group } from 'three';
import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import FeatureProcessing from 'Process/FeatureProcessing';
import GaiaPoint3DProcessing from 'Process/GaiaPoint3DProcessing';
import PointsMaterial, { MODE } from 'Renderer/PointsMaterial';
import Feature2Mesh from 'Converter/Feature2Mesh';

/**
 *
 * @property {boolean} isFeatureGeometryLayer - Used to checkout whether this layer is
 * a FeatureGeometryLayer. Default is true. You should not change this, as it is used
 * internally for optimisation.
 */
class GaiaGeometryLayer extends GeometryLayer {

    constructor(id, config = {}) {
        config.update = GaiaPoint3DProcessing.update;
        config.cacheLifeTime= 1000;
        super(id, config.object3d || new Group(), config);
        // this.cache.listTile = options.cacheLifeTime;
        this.isGaiaGeometryLayer = true;
        this.accurate = true;
        this.buildExtent = !this.accurate;
        this.bboxes = {};
        this.bboxes.visible=true;

        // default config
        this.octreeDepthLimit = config.octreeDepthLimit || -1;
        this.pointBudget = config.pointBudget || 4000000;
        this.pointSize = config.pointSize === 0 || !isNaN(config.pointSize) ? config.pointSize : 4;
        this.sseThreshold = config.sseThreshold || 2;

        this.minIntensityRange = config.minIntensityRange || 0;
        this.maxIntensityRange = config.maxIntensityRange || 1;

        this.material = config.material || {};
        if (!this.material.isMaterial) {
            config.material = config.material || {};
            config.material.intensityRange = new THREE.Vector2(this.minIntensityRange, this.maxIntensityRange);
            this.material = new PointsMaterial(config.material);
        }
        this.material.defines = this.material.defines || {};
        this.mode = config.mode || MODE.COLOR;
    }

    // Verifico se considerata la camera, la tile3D è visibile
    tilesCulling(camera, box3D, tileMatrixWorld) {
        if (box3D && camera.isBox3Visible(box3D, tileMatrixWorld)) {
            return true;
        }
        return false;
    }
    // In base allo Zoom c'è una distanza minima che rende il layer visibile
    checkLayerVisibility(zoom,distance){
        if (zoom == 20 ){
            if (distance < 700){
                return true;
            }
        }else if (zoom == 19 ) {
            if (distance > 500 && distance < 850){
                return true;
            }
        }else if (zoom == 18 ) {
            if (distance > 500 && distance < 1000){
                return true;
            }
        }else if (zoom == 17 ) {
            if (distance > 850 && distance < 2500){
                return true;
            }
        }else if (zoom == 16 ) {
            if (distance > 1000 && distance < 5000){
                return true;
            }
        }else if (zoom == 15 ) {
            if (distance > 2500 && distance < 8000){
                return true;
            }
        }else if (zoom == 14 ) {
            if (distance > 5000 && distance < 15000){
                return true;
            }
        }else if (zoom == 13 ) {
            if (distance > 8000 && distance < 30000){
                return true;
            }
        }
        return false;
    }
    preUpdate(context, sources) {

        /*
        // console.log('pre update');
        if (sources.has(this.parent)) {
            this.object3d.clear();
        }
        */

        var camera = context.camera;
        var cameraPosition = camera.camera3D.position;
        var projectionMatrix = camera.camera3D.projectionMatrix;
        var viewMatrix = camera.camera3D.matrixWorldInverse;
        var frustum = new THREE.Frustum();
        var tileVisible = 0;
        var tileNotVisible = 0;
        var tileDraw = 0;
        var boxCenter = new THREE.Vector3(0,0,0);
        frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(projectionMatrix, viewMatrix));
        for (const tilePoint of this.object3d.children) {
            if (frustum.intersectsBox(tilePoint.geometry.boundingBox)) {
                tilePoint.visible = true;
                tilePoint.lastTimeVisible = 0;
                tilePoint.geometry.setDrawRange(0, tilePoint.geometry.numFeature);
                tileVisible++;
                boxCenter = tilePoint.geometry.boundingBox.min;
                //tilePoint.geometry.boundingBox.getCenter(boxCenter);
                var distance = boxCenter.distanceTo(cameraPosition);
                tilePoint.distance = distance;
                // tilePoint.visible = this.checkLayerVisibility(tilePoint.zoom,tilePoint.distance);
            }else{
                tilePoint.visible = false;
                tilePoint.geometry.setDrawRange(0, 0);
                tileNotVisible++;
                if (tilePoint.lastTimeVisible == 0){
                    tilePoint.lastTimeVisible = Date.now();
                }
            }
        }

        var timeToDelete = 1000;
        var timeNow = Date.now()
        // console.log(this.object3d.children.length);

        // Verifico se ci sono degli elementi da cancellare dalla memoria
        this.object3d.children = this.object3d.children.filter(function (item) {
            if ((item.visible==false) && (item.lastTimeVisible>0) && (timeNow - item.lastTimeVisible>timeToDelete)) {
                // console.log('Delete item ' + item.id);
                return false;
            }else{
                return true;
            }
        });
        // console.log(this.object3d.children.length);



        // Verifico la visibilità delle tile
        // console.log('tilesCulling');
        /*
        var tileVisible = 0;
        var tileNotVisible = 0;
        for (const tilePoint of this.object3d.children) {
            if (tilePoint.geometry && tilePoint.geometry.boundingBox) {
                var result = this.tilesCulling(camera, tilePoint.geometry.boundingBox, tilePoint.matrixWorld);
                if (!result) {
                    tileNotVisible++;
                    tilePoint.visible = false;
                    tilePoint.geometry.setDrawRange(0, 0);
                } else {
                    tileVisible++;
                    tilePoint.visible = true;
                    tilePoint.geometry.setDrawRange(0, tilePoint.geometry.numFeature);
                }
            }
        }
        */
        // console.log(' TileCulling, tile visibile ' + tileVisible);
        // console.log(' TileCulling, tile not visibile ' + tileNotVisible);

        // console.log('update');
        let numElement = 0;
        for (const pts of this.object3d.children) {
            if (pts.visible) {
                const count = pts.geometry.attributes.position.count;
                pts.geometry.setDrawRange(0, count);
                numElement += count;
            }
        }

        // this.pointBudget = 1000 * 1000 * 4;
        var numElementShow = numElement;

        var allTile = true;
        if (numElement > this.pointBudget) {
            if (allTile) {
                // Con questo metodo disegna tutte le tile ma in modo parziale, va bene se i dati sono distribuiti in modo uniforme
                // Calcolo Point budget
                numElementShow = 0;
                const reduction = this.pointBudget / numElement;
                for (var k = 0; k < this.object3d.children.length; k++) {
                    const tilePoint = this.object3d.children[k];
                    const count = Math.floor(tilePoint.geometry.numFeature * reduction);
                    if (count > 0) {
                        tilePoint.visible = true;
                        numElementShow += count;
                        tilePoint.geometry.setDrawRange(0, count);
                    } else {
                        tilePoint.geometry.setDrawRange(0, 0);
                        tilePoint.visible = false;
                    }
                }
            } else {
                // This format doesn't require points to be evenly distributed, so
                // we're going to sort the nodes by "importance" (= on screen size)
                // and display only the first N nodes
                const listTile = this.object3d.children.filter(obj => obj.visible == true);
                //listTile.sort((a, b) => a.distance - b.distance);
                listTile.sort((a, b) => b.zoom - a.zoom);
                // this.group.children.sort((p1, p2) => p2.userData.node.sse - p1.userData.node.sse);

                let limitHit = false;
                numElementShow = 0;
                for (const tilePoint of listTile) {
                    const count = tilePoint.geometry.numFeature;
                    /*
                    // Provo a mostrare solo i layer 20
                    if (count.geometry.inExtent.zoom == 20) {
                        tilePoint.geometry.setDrawRange(0, count);
                        tilePoint.visible = true;
                        limitHit = true;
                    } else {
                        tilePoint.visible = false;
                        tilePoint.geometry.setDrawRange(0, 0);
                    }
                    */
                    if (tilePoint.visible && (limitHit || (numElementShow + count) > this.pointBudget)) {
                        tilePoint.visible = false;
                        tilePoint.geometry.setDrawRange(0, 0);
                        limitHit = true;
                    } else {
                        tilePoint.geometry.setDrawRange(0, count);
                        numElementShow += count;
                        tileDraw++;
                    }

                }
            }
        } else {
            tileDraw = tileVisible;
        }


        this.numElement = 'Point memory: ' + numElement + ' Point show: ' + numElementShow + ' tile draw: ' + tileDraw + ' tile visible: ' + tileVisible + ' tile not visible: ' + tileNotVisible;
    }
}

export default GaiaGeometryLayer;
