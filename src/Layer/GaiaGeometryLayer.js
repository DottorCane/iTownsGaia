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
        this.pointBudget = config.pointBudget || 5000000;
        this.opacity = config.opacity || 1;
        this.pointSize = config.pointSize === 0 || !isNaN(config.pointSize) ? config.pointSize : 1;

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

    updateMaterial(){
        const config = {};
        config.size = this.pointSize;
        config.vertexColors = true;
        var materialNew = new THREE.PointsMaterial(config);
        materialNew.opacity = this.opacity;
        materialNew.transparent = true;
        for (const tilePoint of this.object3d.children) {
            tilePoint.material = materialNew;
            tilePoint.material.needsUpdate = true;
        }
    }

    preUpdate(context, sources) {
        /*
        if (this.material) {
            this.material.visible = this.visible;
            this.material.opacity = this.opacity;
            this.material.transparent = this.opacity < 1;
            this.material.size = this.pointSize;
            if (this.material.updateUniforms) {
                this.material.updateUniforms();
            }
        }*/

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
            var visible = false;

            var boxBoundingBox = tilePoint.geometry.boundingBox
            var boxCenterCalc = new THREE.Vector3((boxBoundingBox.max.x+boxBoundingBox.min.x)/2,(boxBoundingBox.max.y+boxBoundingBox.min.y)/2,(boxBoundingBox.max.z+boxBoundingBox.min.z)/2);

            if (tilePoint.geometry.inExtent.key==="20_392925_567563"){
                boxCenterCalc = boxCenterCalc;
            }
            var distanceCalc = camera.camera3D.position.distanceTo(boxCenterCalc)

            visible = context.camera.isBox3Visible(tilePoint.geometry.boundingBox, this.object3d.matrixWorld);

            //Se la tile è più vicina di 100 metri la lascio sempre accesa.
            //Per qualche motivo non chiaro alcuni box pur essendo visibili quando ci si avvicina, vengono segnalati
            //come non visibili. Questa soglia risolve il problema, pur lasciando accese delle tile non visibili.
            if (distanceCalc<100){
                visible = true;
            }

            //Le tile di livello 20 sono molto pesante e quindi vanno mostrate solo a scale basse
            if (tilePoint.zoom==20 && visible) {
                var boxCenter = tilePoint.geometry.boundingBox.min;
                var distance = boxCenter.distanceTo(cameraPosition);
                tilePoint.distance = distance;
                if (distance>250) {
                    visible=false;
                }
            }

            if (visible) {
                tilePoint.visible = true;
                tilePoint.lastTimeVisible = 0;
                //tilePoint.geometry.setDrawRange(0, tilePoint.geometry.numFeature);
                tileVisible++;
            }else{
                tilePoint.visible = false;
                //tilePoint.geometry.setDrawRange(0, 0);
                tileNotVisible++;
                if (tilePoint.lastTimeVisible == 0){
                    tilePoint.lastTimeVisible = Date.now();
                }
            }
        }

        var timeToDelete = 10000;
        var timeNow = Date.now();

        // Verifico se ci sono degli elementi da cancellare dalla memoria
        this.object3d.children = this.object3d.children.filter(function (item) {
            if ((item.visible==false) && (item.lastTimeVisible>0) && (timeNow - item.lastTimeVisible>timeToDelete)) {
                return false;
            }else{
                return true;
            }
        });

        //Calcolo il numero massimo di elementi da visualizzare
        let numElement = 0;
        for (const pts of this.object3d.children) {
            if (pts.visible) {
                const count = pts.geometry.attributes.position.count;
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


        this.numElement = 'Point memory: ' + numElement + ' Point show: ' + numElementShow + ' tile total: ' + tileDraw + ' tile visible: ' + tileVisible + ' tile not visible: ' + tileNotVisible + " ";
        /*
        for (const tilePoint of this.object3d.children) {
            if (!tilePoint.visible){
                var key = tilePoint.geometry.inExtent.zoom + '_' + tilePoint.geometry.inExtent.row + '_' + tilePoint.geometry.inExtent.col;
                //this.numElement = this.numElement + key + " ";
            }
        }
        this.numElement = this.numElement + " visible: ";
        for (const tilePoint of this.object3d.children) {
            if (tilePoint.visible){
                var key = tilePoint.geometry.inExtent.zoom + '_' + tilePoint.geometry.inExtent.row + '_' + tilePoint.geometry.inExtent.col;
                //this.numElement = this.numElement + key + " ";
            }
        }*/
    }

    postUpdate() {
    }
}

export default GaiaGeometryLayer;
