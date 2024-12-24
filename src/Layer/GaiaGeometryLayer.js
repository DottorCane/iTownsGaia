import { Group } from 'three';
import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import FeatureProcessing from 'Process/FeatureProcessing';
import GaiaPoint3DProcessing from 'Process/GaiaPoint3DProcessing';
import PointsMaterial, { PNTS_MODE } from 'Renderer/PointsMaterial';
import Feature2Mesh from 'Converter/Feature2Mesh';
import Extent from 'Core/Geographic/Extent';

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
        //this.buildExtent = !this.accurate;
        this.bboxes = {};
        this.bboxes.visible=true;

        if (config.offset){
            if (config.offset.x===undefined){
                config.offset.x = 0;
            }
            if (config.offset.y===undefined){
                config.offset.y = 0;
            }
            if (config.offset.z===undefined){
                config.offset.z = 0;
            }
            this.offset = new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z);
            this.offsetInitial = new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z);
        }


        // default config
        this.octreeDepthLimit = config.octreeDepthLimit || -1;
        this.pointBudget = config.pointBudget || 2000000;
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
        this.mode = config.mode || PNTS_MODE.COLOR;
    }

    createPointsElement(geometry){
        if (!geometry){
            return;
        }
        const config = {};
        config.size = this.pointSize;
        config.vertexColors = true;

        var key = geometry.inExtent.zoom + '_' + geometry.inExtent.row + '_' + geometry.inExtent.col;
        geometry.inExtent.key = key;

        //Cerco che l'elemento con questa chiave. Se è già presente nel layer non lo inserisco più volte
        for (const tilePoint of this.object3d.children) {
            if (tilePoint.geometry.inExtent.key === key ){
                return;
            }
        }

        var material = new THREE.PointsMaterial(config);
        if (this.opacity<1){
            material.opacity = this.opacity;
            material.transparent = true;
        }
        // const material = new THREE.PointsMaterial({ color: 0x000000 });
        const points = new THREE.Points(geometry, material);
        points.zoom = geometry.inExtent.zoom;
        points.lastTimeVisible = 0;

        var pointFinal;
        if (this.offset){
            pointFinal = points.geometry.boundingBox.min.clone().add(this.offset);
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

        points.updateMatrix();
        // points.tightbbox = geometry.boundingBox.applyMatrix4(points.matrix);
        points.layers.set(this.threejsLayer);
        points.layer = this;
        return points;
        //this.object3d.add(points);
        //this.object3d.updateMatrixWorld();
    }
    // Verifico se considerata la camera, la tile3D è visibile
    tilesCulling(camera, box3D, tileMatrixWorld) {
        if (box3D && camera.isBox3Visible(box3D, tileMatrixWorld)) {
            return true;
        }
        return false;
    }
    calcKeyExtent(inExtent){
        var key = inExtent.zoom + '_' + inExtent.row + '_' + inExtent.col;
        return key;
    }
    // In base allo Zoom c'è una distanza minima che rende il layer visibile
    checkTileVisibility(zoom,distance){
        if (zoom == 21 ){
            if (distance > 150){
                return false;
            }
        }else if (zoom == 20 ){
            if (distance > 350){
                return false;
            }
        }else if (zoom == 19 ) {
            if (distance > 500){
                return false;
            }
        }else if (zoom == 18 ) {
            if (distance>  7500){
                return false;
            }
        }else if (zoom == 17 ) {
            if (distance > 1000){
                return false;
            }
        }
        return true;
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
    updatePosition(){
        for (const tilePoint of this.object3d.children) {
            var pointFinal = tilePoint.geometry.boundingBox.min.clone().sub(this.offsetInitial);
            var pointFinal = pointFinal.add(this.offset);
            tilePoint.position.copy(pointFinal);
        }
    }

    requestLoadTile(extent,dictAllTile){
        var that = this;
        var key = this.calcKeyExtent(extent);
        if (dictAllTile[key]){
            return;
        }
        var promise = this.source.loadData(extent,this);
        if (promise==undefined || promise == null){
            return;
        }
        promise.then(
            function(v) {
                var points = that.createPointsElement(v);
                if (points!=null) {
                    that.object3d.add(points);
                    that.object3d.updateMatrixWorld();
                }
            },
            function(e) {
                //Error
            }
        );
    }
    preUpdate(context, sources) {
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
        var dictTileSearchZoom = [];
        var dictAllTile = {}
        for (const tilePoint of this.object3d.children) {
            //traccio tutte le tile che sono lette in un dizionario
            dictAllTile[tilePoint.geometry.inExtent.key] = true;
            var visible = false;

            var boxBoundingBox = tilePoint.geometry.boundingBox
            var boxCenterCalc = new THREE.Vector3((boxBoundingBox.max.x+boxBoundingBox.min.x)/2,(boxBoundingBox.max.y+boxBoundingBox.min.y)/2,(boxBoundingBox.max.z+boxBoundingBox.min.z)/2);

            var distanceCalc = camera.camera3D.position.distanceTo(boxCenterCalc)

            visible = context.camera.isBox3Visible(tilePoint.geometry.boundingBox, this.object3d.matrixWorld);

            //Se la tile è più vicina di 100 metri la lascio sempre accesa.
            //Per qualche motivo non chiaro alcuni box pur essendo visibili quando ci si avvicina, vengono segnalati
            //come non visibili. Questa soglia risolve il problema, pur lasciando accese delle tile non visibili.
            if (distanceCalc<100){
                //console.log(distanceCalc);
                visible = true;
                //Salvo gli extent con scala 20 per vedere se quelle di livello 21 sono già caricate oppure se vanno recuperate
                if (tilePoint.zoom==20){
                    dictTileSearchZoom.push(tilePoint.geometry.inExtent)
                }
            }

            if (visible){
                visible = this.checkTileVisibility(tilePoint.zoom,distanceCalc)
            }
            /*
            //Le tile di livello 20 sono molto pesante e quindi vanno mostrate solo a scale basse
            if (tilePoint.zoom==20 && visible) {
                var boxCenter = tilePoint.geometry.boundingBox.min;
                var distance = boxCenter.distanceTo(cameraPosition);
                tilePoint.distance = distance;
                checkTileVisibility()
                if (distance>250) {
                    visible=false;
                }
            }*/

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

        var timeToDelete = 5000;
        var timeNow = Date.now();

        // Verifico se ci sono degli elementi da cancellare dalla memoria
        this.object3d.children = this.object3d.children.filter(function (item) {
            if ((item.visible==false) && (item.lastTimeVisible>0) && (timeNow - item.lastTimeVisible>timeToDelete)) {
                return false;
            }else{
                return true;
            }
        });

        //Verifico se ci sono Tile di livello 21 da leggere
        for (var i=0;i<dictTileSearchZoom.length;i++){
            var extentTemp = dictTileSearchZoom[i];
            //Ogni tile ha quattro figli
            var ext1 = new Extent(extentTemp.crs, 21, (extentTemp.row*2), (extentTemp.col*2));
            var ext2 = new Extent(extentTemp.crs, 21, (extentTemp.row*2)+1, (extentTemp.col*2));
            var ext3 = new Extent(extentTemp.crs, 21, (extentTemp.row*2), (extentTemp.col*2)+1);
            var ext4 = new Extent(extentTemp.crs, 21, (extentTemp.row*2)+1, (extentTemp.col*2)+1);
            this.requestLoadTile(ext1,dictAllTile);
            this.requestLoadTile(ext2,dictAllTile);
            this.requestLoadTile(ext3,dictAllTile);
            this.requestLoadTile(ext4,dictAllTile);
        }

        //Calcolo il numero massimo di punti da visualizzare per gli elementi attivi
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
