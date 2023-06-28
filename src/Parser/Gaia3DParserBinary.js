import * as THREE from 'three';

export default {

    parse: function parse(buffer, options) {

        if (buffer.byteLength  < 50) {
            return Promise.resolve(null);
        }

        const view = new DataView(buffer);

        let offsetX = 0;
        let offsetY = 0;
        let offsetZ = 0;
        //Leggo l'eventuale spostamento che viene passato al layer
        if (options.in.offset != undefined) {
            if (options.in.offset.x != undefined) {
                offsetX = options.in.offset.x;
            }
            if (options.in.offset.y != undefined) {
                offsetY = options.in.offset.y;
            }
            if (options.in.offset.z != undefined) {
                offsetZ = options.in.offset.z;
            }
        }

        // Ogni double occupa 8 byte
        //const min = new THREE.Vector3(view.getFloat64(0).toFixed(2), view.getFloat64(8).toFixed(2), view.getFloat64(16).toFixed(2));
        //const max = new THREE.Vector3(view.getFloat64(24).toFixed(2), view.getFloat64(32).toFixed(2), view.getFloat64(40).toFixed(2));
        const min = new THREE.Vector3(view.getFloat64(0), view.getFloat64(8), view.getFloat64(16));
        const max = new THREE.Vector3(view.getFloat64(24), view.getFloat64(32), view.getFloat64(40));
        const box = new THREE.Box3(min, max);

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
            coordinates.push((valueX * xDelta) + offsetX);
            coordinates.push((valueY * yDelta) + offsetY);
            coordinates.push((valueZ * zDelta) + offsetZ);
            /*
            const floatValueX = view.getFloat64(offset);offset += 8;
            const floatValueY = view.getFloat64(offset);offset += 8;
            const floatValueZ = view.getFloat64(offset);offset += 8;
            coordinates.push(floatValueX + offsetX);
            coordinates.push(floatValueY + offsetY);
            coordinates.push(floatValueZ + offsetZ);
            */
            //coordinatesInt.push(parseInt(floatValueX + offsetX));
            //coordinatesInt.push(parseInt(floatValueY + offsetY));
            //coordinatesInt.push(parseInt(floatValueZ + offsetZ));

            const colorR = view.getInt8(offset);offset += 1;
            const colorG = view.getInt8(offset);offset += 1;
            const colorB = view.getInt8(offset);offset += 1;
            color.push(colorR);
            color.push(colorG);
            color.push(colorB);
            numFeature++;
        }
        //console.log(delta + " Zoom: " + buffer.extent.zoom);
        if (coordinates.length == 0) {
            return Promise.resolve(null);
        }
        const positionsTypedArray = new Float32Array(coordinates);
        //const positionsTypedArrayInt = new Float32Array(coordinatesInt);
        const colorTypedArray = new Uint8Array(color);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArray, 3));
        //geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArrayInt, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorTypedArray, 3, true));
        geometry.boundingBox = box;
        geometry.inExtent = buffer.extent;
        geometry.numFeature = numFeature;
        // console.log(numFeature);
        return Promise.resolve(geometry);


        /*
        if (json.features === undefined || json.features.length === 0) {
            return Promise.resolve(null);
        }

        // options = deprecatedParsingOptionsToNewOne(options);
        options.in = options.in || {};

        const out = options.out;
        const _in = options.in;
        // var crsIn = _in.crs || readCRS(json);

        // Format: MinX,MinY,MinZ,MaxX,MaxY,MaxZ,X1,Y1,Z1,[...],XN,YN,ZN,R1,G1,B1,A1,[...],RN,GN,BN,AN
        // const view = new DataView(buffer, 0, 6 * 4);
        // Per il momento definisco la Z in modo statico, poi si vedrà

        const min = new THREE.Vector3(json.bbox[0], json.bbox[1], 4167299);
        const max = new THREE.Vector3(json.bbox[2], json.bbox[3], 4167421);
        const box = new THREE.Box3(min, max);

        const positions = [];
        const color = [];
        var featureRead = null;

        for (let i = 0; i < json.features.length; i++) {
          // Genera coordinate casuali per ogni punto
          featureRead = json.features[i];
          var attribute = featureRead.properties;

          if (featureRead.geometry.type === 'MultiPoint') {
            for (var k = 0; k < featureRead.geometry.coordinates.length; k++) {
                 positions.push(featureRead.geometry.coordinates[k][0]);
                 positions.push(featureRead.geometry.coordinates[k][1]);
                 positions.push(featureRead.geometry.coordinates[k][2]);
                 // positions.push(featureRead.geometry.coordinates[k]);
                 // coordinates.push(featureRead.geometry.coordinates[k]);
            }
            color.push(attribute.r, attribute.g, attribute.b);
          } else {
            // Allora ho un punto singolo
            positions.push(featureRead.geometry.coordinates[0]);
            positions.push(featureRead.geometry.coordinates[1]);
            positions.push(featureRead.geometry.coordinates[2]);
            color.push(attribute.r, attribute.g, attribute.b);
          }
        }
        if (positions.length == 0) {
            return Promise.resolve(null);
        }
        const positionsTypedArray = new Float32Array(positions);
        const colorTypedArray = new Uint8Array(color);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArray, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorTypedArray, 3, true));
        geometry.boundingBox = box;

        return Promise.resolve(geometry);
        */
    },
};
