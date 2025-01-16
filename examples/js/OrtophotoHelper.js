/* global itowns */

// set object position to the coordinate
// set object ENH orientation: X to the east, Y (green) to the north, Z (blue) look to the sky.
function placeObjectFromCoordinate(object, coord) {
    // set object position to the coordinate
    coord.toVector3(object.position);
    // set ENH orientation, looking at the sky (Z axis), so Y axis look to the north..
    object.lookAt(coord.geodesicNormal.clone().add(object.position));
}

function createTexturedSphere(textureUrl, opacity) {
    var texture;
    var geometry;
    var material;

    texture = new itowns.THREE.TextureLoader().load(textureUrl);
    texture.colorSpace = itowns.THREE.SRGBColorSpace;
    geometry = new itowns.THREE.SphereGeometry(100, 16, 16);
    // invert the geometry on the x-axis so that all of the faces point inward
    geometry.scale( - 1, 1, 1 );
    material = new itowns.THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: opacity,
    });
    var sphere = new itowns.THREE.Mesh(geometry, material);
    var sphereCenter = new itowns.THREE.Vector3();
    sphere.getWorldPosition(sphereCenter);
    sphere.position.y+= +50;
    sphere.updateMatrixWorld();
    return sphere;
}

function updateTexturedSphere(textureUrl, mesh,view) {
    var textureLoader = new itowns.THREE.TextureLoader();
    var newTexture = textureLoader.load(
        textureUrl,
        function () {
            console.log('La texture è stata caricata!');
            //var newTexture = new itowns.THREE.TextureLoader().load(textureUrl);
            newTexture.colorSpace = itowns.THREE.SRGBColorSpace;
            var newMaterial = new itowns.THREE.MeshBasicMaterial({ map: newTexture });
            mesh.material = newMaterial;
            view.notifyChange();
        },
        function (xhr) {
            console.log((xhr.loaded / xhr.total * 100) + '% caricato');
        },
        function (error) {
            console.error('Errore nel caricamento della texture', error);
        }
    );
    var newTexture = new itowns.THREE.TextureLoader().load(textureUrl);
    newTexture.colorSpace = itowns.THREE.SRGBColorSpace;
    var newMaterial = new itowns.THREE.MeshBasicMaterial({ map: newTexture });
    mesh.material = newMaterial;
    //mmesh.material.map.needsUpdate = true;
    //mesh.updateMatrixWorld();
}




function transformTexturedSphere(camera, distance, sphere) {
    var Yreel = 2 * Math.tan(itowns.THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    var Xreel = camera.aspect * Yreel;

    // set position and scale
    //sphere.scale.set(Xreel, Yreel, 1);
    //sphere.scale.set(100, 100, 100);
    //sphere.position.set(0, 0, -((distance/2)- 2000)  );

    var sphereCenter = new itowns.THREE.Vector3();
    sphere.getWorldPosition(sphereCenter);
    //sphere.position.y+= +50;
    sphere.updateMatrixWorld();

}

// eslint-disable-next-line no-unused-vars
function initCamera(view, image, coord, EnhToOrientationUp, EnhToOrientationLookAt, rotMatrix,
    orientationToCameraUp, orientationToCameraLookAt, distance, size, focale) {
    var fov = itowns.THREE.MathUtils.radToDeg((2 * Math.atan((size[1] / 2) / focale)));
    var coordView;
    var localSpace;
    var orientedImage;
    var quaternion;
    var camera;

    coordView = coord.as(view.referenceCrs);
    // create 'local space', with the origin placed on 'coord',
    // with Y axis to the north, X axis to the east and Z axis as the geodesic normal.
    localSpace = new itowns.THREE.Object3D();
    view.scene.add(localSpace);
    placeObjectFromCoordinate(localSpace, coordView);

    // add second object : 'oriented image'
    orientedImage = new itowns.THREE.Object3D();
    // setup initial convention orientation.
    orientedImage.up.copy(EnhToOrientationUp);
    orientedImage.lookAt(EnhToOrientationLookAt);

    // place the 'oriented image' in the 'local space'
    localSpace.add(orientedImage);

    // apply rotation
    quaternion = new itowns.THREE.Quaternion().setFromRotationMatrix(rotMatrix);
    orientedImage.quaternion.multiply(quaternion);
    // orientedImage.updateMatrixWorld();

    // create a THREE JS Camera
    camera = new itowns.THREE.PerspectiveCamera(fov, size[0] / size[1], distance / 2, distance * 2);
    camera.up.copy(orientationToCameraUp);
    camera.lookAt(orientationToCameraLookAt);

    orientedImage.add(camera);

    localSpace.updateMatrixWorld(true);
    camera.localSpace;
    return camera;
}

// eslint-disable-next-line no-unused-vars
function setupPictureFromCamera(camera, imageUrl, opacity, distance) {
    // create a textured plane, representing the picture.
    //var plane = createTexturedPlane(imageUrl, opacity);
    //camera.add(plane);
    var sphere = createTexturedSphere(imageUrl, opacity);
    camera.add(sphere);

    //transformTexturedPlane(camera, distance, plane);
    transformTexturedSphere(camera, distance,sphere);

    return sphere;
}

// set camera settings to view.camera,
// BUT keep the geodesic normal as Up vector
// eslint-disable-next-line no-unused-vars
function setupViewCameraLookingAtObject(camera, coord, objectToLookAt) {
    camera.position.copy(coord);
    camera.up.copy(coord.geodesicNormal);
    camera.lookAt(objectToLookAt.getWorldPosition());
}

// set camera settings to view.camera, even the up vector !
// eslint-disable-next-line no-unused-vars
function setupViewCameraDecomposing(view, camera) {
    var upWorld;
    var viewCamera = view.camera.camera3D;
    camera.matrixWorld.decompose(viewCamera.position, viewCamera.quaternion, viewCamera.scale);

    // setup up vector
    upWorld = camera.localToWorld(camera.up.clone());
    upWorld = viewCamera.position.clone().sub(upWorld);
    viewCamera.up.copy(upWorld);
}

// add a camera helper to debug camera position..
// eslint-disable-next-line no-unused-vars
function addCameraHelper(view, camera) {
    var cameraHelper = new itowns.THREE.CameraHelper(camera);
    view.scene.add(cameraHelper);
    cameraHelper.updateMatrixWorld(true);
}

// eslint-disable-next-line no-unused-vars
function setupPictureUI(menu, pictureInfos, plane, updateDistanceCallback, view, min, max) {
    var orientedImageGUI = menu.gui.addFolder('Oriented Image');
    orientedImageGUI.add(pictureInfos, 'distance', min, max).name('Distance').onChange(function distanceChanged(value) {
        pictureInfos.distance = value;
        updateDistanceCallback();
        view.notifyChange();
    });
    orientedImageGUI.add(pictureInfos, 'opacity', 0, 1).name('Opacity').onChange(function opacityChanged(value) {
        plane.material.opacity = value;
        view.notifyChange();
    });
}
