import * as THREE from 'three';
import Coordinates from 'Core/Geographic/Coordinates';

export default {

    parse: function parse(buffer, options) {

        if (buffer.byteLength  < 50) {
            return Promise.resolve(null);
        }

        const view = new DataView(buffer);

        // Ogni double occupa 8 byte
        var coordsMin = new Coordinates('EPSG:4326', view.getFloat64(0), view.getFloat64(8), view.getFloat64(16));
        var coordsMinPrj = coordsMin.as('EPSG:4978');
        var coordsMax = new Coordinates('EPSG:4326', view.getFloat64(24), view.getFloat64(32), view.getFloat64(40));
        var coordsMaxPrj = coordsMax.as('EPSG:4978');
        const min = new THREE.Vector3(coordsMinPrj.x,coordsMinPrj.y,coordsMinPrj.z);
        const max = new THREE.Vector3(coordsMaxPrj.x,coordsMaxPrj.y,coordsMaxPrj.z);

        const box = new THREE.Box3(min, max);
        box.zoom = buffer.extent.zoom;
        box.col = buffer.extent.col;
        box.row = buffer.extent.row;
        box.extent = buffer.extent;

        const xMin = view.getFloat64(0);
        const yMin = view.getFloat64(8);
        const zMin = view.getFloat64(16);

        const xDelta = view.getFloat64(48);
        const yDelta = view.getFloat64(56);
        const zDelta = view.getFloat64(64);

        const out = options.out;

        var color = [];
        var  coordinates = [];
        //var  coordinatesInt = [];
        var featureRead = null;
        // Sottraggo i dati dell'extent della tile (9 * 8)
        var offset = 72;
        var bufferFeature = buffer.byteLength - offset;

        var oldX=0; var oldY=0; var oldZ = 0;
        var delta = 0;
        // Le coordinate sono 3 float, quindi 4 byte e ogni colore è un byte
        //var numFeatureBuffer = bufferFeature / ((3 * 4) + (3 * 1));
        var numFeatureBuffer = bufferFeature / ((3 * 2) + (3 * 1));
        var numFeature = 0;

        for (var index = 0; index < numFeatureBuffer; index++) {
            const valueX = view.getUint16(offset);offset += 2;
            const valueY = view.getUint16(offset);offset += 2;
            const valueZ = view.getUint16(offset);offset += 2;

            var X =    (valueX * xDelta) + xMin;
            var Y =    (valueY * yDelta) + yMin;
            var Z =    (valueZ * zDelta) + zMin;

            var coords = new Coordinates('EPSG:4326', X, Y, Z);
            var coordsPrj = coords.as('EPSG:4978');

            coordinates.push((coordsPrj.x-coordsMinPrj.x));
            coordinates.push((coordsPrj.y-coordsMinPrj.y));
            coordinates.push((coordsPrj.z-coordsMinPrj.z));

            const colorR = view.getInt8(offset);offset += 1;
            const colorG = view.getInt8(offset);offset += 1;
            const colorB = view.getInt8(offset);offset += 1;
            //TODO: Non mi è chiaro perché i dati sono salvati in formato RGB ma se non vengono inseriti come RBG i colori non sono corretti
            color.push(colorR);
            color.push(colorB);
            color.push(colorG);
            numFeature++;
        }
        if (coordinates.length == 0) {
            return Promise.resolve(null);
        }
        const positionsTypedArray = new Float32Array(coordinates);
        const colorTypedArray = new Uint8Array(color);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArray, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorTypedArray, 3, true));
        geometry.boundingBox = box;
        geometry.inExtent = buffer.extent;
        geometry.numFeature = numFeature;
        return Promise.resolve(geometry);
    },
};
