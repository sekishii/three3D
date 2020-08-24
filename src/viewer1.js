const THREE = window.THREE = require('three');
const Stats = require('../lib/stats.min');
const dat = require('dat.gui');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

require('three/examples/js/loaders/GLTFLoader');
require('three/examples/js/loaders/DRACOLoader');
require('three/examples/js/loaders/DDSLoader');
require('three/examples/js/controls/OrbitControls');
require('three/examples/js/loaders/RGBELoader');
require('three/examples/js/loaders/HDRCubeTextureLoader');
require('three/examples/js/pmrem/PMREMGenerator');
require('three/examples/js/pmrem/PMREMCubeUVPacker');
require('three/examples/js/utils/BufferGeometryUtils');
require('three/examples/js/controls/TrackballControls');
require('three/examples/js/controls/TransformControls');
require('three/examples/js/controls/DragControls');

THREE.DRACOLoader.setDecoderPath( 'lib/draco/' );

const DEFAULT_CAMERA = '[default]';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// glTF texture types. `envMap` is deliberately omitted, as it's used internally
// by the loader but not part of the glTF format.
const MAP_NAMES = [
  'map',
  'aoMap',
  'emissiveMap',
  'glossinessMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
];

const Preset = {ASSET_GENERATOR: 'assetgenerator'};

module.exports = class Viewer {

  constructor (el, options, cameraContent) {
    this.el = el;
    this.options = options;
    this.cameraContent = cameraContent;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;
    this.cameraArray = [];
    this.selectObject = null;
    this.objects = [];
    this.group = new THREE.Group();

    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
        ? 'Footprint Court (HDR)'
        : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: false,

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      ambientIntensity: 1.7,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8 * Math.PI, // TODO(#116)
      directColor: 0xFFFFFF,
      bgColor1: '#ffffff',
      bgColor2: '#353535',
      显示: true,
      显示坐标: false,
      水平角度旋转: 0,
      垂直角度旋转: 0,
      坐标X: 0,
      坐标Y: 0,
      坐标Z: 0
    };

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    const fov = options.preset === Preset.ASSET_GENERATOR
      ? 0.8 * 180 / Math.PI
      : 60;
    this.defaultCamera = new THREE.PerspectiveCamera( fov, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.activeCamera = this.defaultCamera;
    this.scene.add( this.defaultCamera );

    this.renderer = window.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.physicallyCorrectLights = true;
    this.renderer.gammaOutput = true;
    this.renderer.gammaFactor = 2.2;
    this.renderer.setClearColor( 0xcccccc );
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( el.clientWidth, el.clientHeight );

    this.controls = new THREE.OrbitControls( this.defaultCamera, this.renderer.domElement );
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2;

    const self = this;

    this.background = createVignetteBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: [this.state.bgColor1, this.state.bgColor2]
    });

    this.el.appendChild(this.renderer.domElement);

    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];
    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

    this.addGUI();
    if (options.kiosk) this.gui.close();

    // 文件下载LINK初期化
    this.link = document.createElement( 'a' );
    this.link.style.display = 'none';
    document.body.appendChild( this.link );

    // 读取外部JSON数据设置内部相机模型
    var dataJson = JSON.parse(this.cameraContent);
    // console.log(dataJson);
    console.log(dataJson.camears);
    self.initGeometry2(dataJson.camears);
    this.scene.add( this.group );

    // 选中内部模型初期化
    var subModal = document.createElement('input');
    subModal.setAttribute("type", "hidden");
    subModal.setAttribute("class", "modal");
    subModal.setAttribute("id", "selectedModal");
    document.body.appendChild(subModal);

    // 内部模型导出Event监听
    document.getElementById( 'export_scenes' ).addEventListener( 'click', function () {
      var exporter = new THREE.GLTFExporter();
      // self.scenes.push(self.scene);
      exporter.parse( self.scene, function ( gltf ) {

        // console.log( self.scene );
        var output = JSON.stringify( gltf, null, 2 );
        var modalOutput = JSON.stringify( self.cameraArray, null, 2 );
        // console.log( output );
        self.saveString(output, modalOutput, 'model_exp.gltf' );
      }, null );
    } );

    // 内部动态追加摄像头Event监听
    document.getElementById( 'add_modal' ).addEventListener( 'click', function () {
      self.initGeometry2(null);
    } );

    // 内部模型点击Event监听
    this.renderer.domElement.addEventListener( 'click', function (event) {

      var x = ( event.layerX / window.innerWidth ) * 2 - 1;
      var y = - ( event.layerY / window.innerHeight ) * 2 + 1;
      var mouseVector = new THREE.Vector3(x, y, 0.5);
      var raycaster = new THREE.Raycaster();
      raycaster.setFromCamera( mouseVector, self.defaultCamera );
      // console.log(self.group);
      var intersects = raycaster.intersectObjects( self.group.children, true );
      // console.log(self.group);

      console.log("length:"+intersects.length);

      if ( intersects.length > 0 && self.selectedObject!=intersects[0].object) {
          if (self.selectedObject) {

            self.selectedObject.material.emissive.setHex( 0x000000 );
            self.selectedObject = null;
          }

          var res = intersects.filter( function ( res ) {
              return res && res.object;
          } )[0];
          if ( res && res.object ) {
              // console.log(res.object);
              self.selectedObject = res.object; 
              console.log(self.selectedObject);
              console.log(self.selectedObject.uuid);
              self.selectedObject.material.emissive.setHex( 0xffd700 );

              var infoDiv = document.querySelector('#selectedModal');
              var info = self.selectedObject;
              infoDiv.innerHTML = info.position.x + "\n" + info.position.y + "\n" + info.position.z;
              // alert(infoDiv.innerHTML);

          }
          // intersects[0].object.material.color.set( '#ff0' );
      } 

    } );


    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  saveString( text, modalOutput, filename ) {
    // this.save( new Blob( [ text ], { type: 'text/plain' } ), filename );
    this.save( new Blob( [ modalOutput ], { type: 'text/plain' } ), "camera.json" );
  }

  save( blob, filename ) {
    this.link.href = URL.createObjectURL( blob );
    this.link.download = filename;
    this.link.click();
    // URL.revokeObjectURL( url ); breaks Firefox...
  }

  initGeometry2(camears) {

    var loader = new THREE.GLTFLoader();
    loader.setDRACOLoader( new THREE.DRACOLoader() );
    
    let self = this;

    // for (var i = 0; i < count; i ++)

    if (camears) {
      camears.forEach(function(item, index) {

        // var gltfFile = item.type;
        var gltfFile = 'img/' + item.type + ".gltf"
        // console.log(gltfFile);

        loader.load(gltfFile, function (gltf) {
            
            var model = gltf.scene;
            model.traverse(function (object) {
                if (object.isMesh) {
                    // console.log("object:" + object);
                    console.log(object.uuid);
                    console.log(gltfFile);
                     // console.log(object.material);
                    // object.castShadow = true;
                    // var color = new THREE.Color();
                    // color.setHex( 0xFFFF00 );
                    object.material = new THREE.MeshStandardMaterial();
                    // console.log(object.material.color.getHex());
                    self.objects.push(object);
                    // self.group.add(object);
                }
            });

            model.rotation.x = item.rotation_x;
            model.rotation.y = item.rotation_y;
            model.rotation.z = item.rotation_z;
            model.position.x = item.position_x;
            model.position.y = item.position_y;
            // model.position.z = Math.random() * (50 - 0) - 25;
            model.position.z = item.position_z;
            model.scale.set(0.22, 0.22, 0.22);

            // self.group.add(model);

            self.scene.add(model);

            var groupChild = new THREE.Group();
            groupChild.add(model);
            self.group.add(groupChild);


            self.cameraArray.push(item);

        },

        function ( xhr ) {
          console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
        },
        function ( error ) {

          console.log( 'An error happened' );
          console.log( error );

        });
      });
    } else {

     loader.load('img/Camera.gltf', function (gltf) {
        
        var model = gltf.scene;
        model.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                console.log(object);
                self.objects.push(object);
                // self.group.add(object);
            }
        });

        model.rotation.x = 0;
        model.rotation.y = Math.random() * 2 * Math.PI;;
        model.rotation.z = -0.2 * Math.PI;
        model.position.x = 0;
        model.position.y = Math.random() * 0.5;
        // model.position.z = Math.random() * (50 - 0) - 25;
        model.position.z = 0;
        model.scale.set(0.5, 0.5, 0.5);

        // self.group.add(model);
        self.scene.add(model);

        var groupChild = new THREE.Group();
        groupChild.add(model);
        self.group.add(groupChild);
        // self.group.add(model);
       
        var camera = {
          "id"  : (self.cameraArray.length + 1),
          "name" : "camera" + (self.cameraArray.length + 1 ),
          "rotation_x" : model.rotation.x,
          "rotation_y" : model.rotation.y,
          "rotation_z" : model.rotation.z,
          "position_x" : model.position.x,
          "position_y" : model.position.y,
          "position_z" : model.position.z
        };
        self.cameraArray.push(camera);
      }); 
    }


    console.log(self.cameraArray);
    

    var dragControls = new THREE.DragControls( this.objects, this.defaultCamera, this.renderer.domElement );
    // dragcontrols.enabled = false;
    dragControls.addEventListener( 'dragstart', function () {
      self.controls.enabled = false;
    } );
    dragControls.addEventListener( 'dragend', function () {
      self.controls.enabled = true;
    } );

    // dragcontrols.addEventListener( 'hoveron', function ( event ) {
    //   this.transformControl.attach( event.object );
    //   this.cancelHideTransform();
    // } );
    // dragcontrols.addEventListener( 'hoveroff', function () {
    //   this.delayHideTransform();
    // } );
  }

  animate (time) {

    requestAnimationFrame( this.animate );

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render () {

    this.renderer.render( this.scene, this.activeCamera );

  }

  resize () {

    const {clientHeight, clientWidth} = this.el.parentElement;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.background.style({aspect: this.defaultCamera.aspect});
    this.renderer.setSize(clientWidth, clientHeight);

  }

  load ( url, rootPath, assetMap, cameraContent ) {

    const baseURL = THREE.LoaderUtils.extractUrlBase(url);

    // Load.
    return new Promise((resolve, reject) => {

      const manager = new THREE.LoadingManager();

      // Intercept and override relative URLs.
      manager.setURLModifier((url, path) => {

        const normalizedURL = rootPath + url
          .replace(baseURL, '')
          .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;
      });

      const loader = new THREE.GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.setDRACOLoader( new THREE.DRACOLoader() );
      const blobURLs = [];

      // console.log('URL:' + url);
      // url = 'img/model2.gltf'

      loader.load(url, (gltf) => {

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];
        this.setContent(scene, clips);

        blobURLs.forEach(URL.revokeObjectURL);

        // See: https://github.com/google/draco/issues/349
        // THREE.DRACOLoader.releaseDecoderModule();

        resolve(gltf);

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   */
  setContent ( object, clips ) {

    this.clear();

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();

    if (this.options.cameraPosition) {

      this.defaultCamera.position.fromArray( this.options.cameraPosition );
      this.defaultCamera.lookAt( new THREE.Vector3() );

    } else {

      this.defaultCamera.position.copy(center);
      this.defaultCamera.position.x += size / 2.0;
      this.defaultCamera.position.y += size / 5.0;
      this.defaultCamera.position.z += size / 2.0;
      this.defaultCamera.lookAt(center);

    }

    this.setCamera(DEFAULT_CAMERA);

    this.controls.saveState();

    this.scene.add(object);
    this.content = object;

    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.setClips(clips);

    this.updateLights();
    this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateDisplay();

    window.content = this.content;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    this.printGraph(this.content);

  }

  printGraph (node) {

    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();

  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips ( clips ) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer( this.content );
  }

  playAllClips () {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera ( name ) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding () {
    const encoding = this.state.textureEncoding === 'sRGB'
      ? THREE.sRGBEncoding
      : THREE.LinearEncoding;
    traverseMaterials(this.content, (material) => {
      if (material.map) material.map.encoding = encoding;
      if (material.emissiveMap) material.emissiveMap.encoding = encoding;
      if (material.map || material.emissiveMap) material.needsUpdate = true;
    });
  }

  updateLights () {
    const state = this.state;
    const lights = this.lights;

    if (state.addLights && !lights.length) {
      this.addLights();
    } else if (!state.addLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMappingExposure = state.exposure;

    if (lights.length === 2) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }
  }

  addLights () {
    const state = this.state;

    if (this.options.preset === Preset.ASSET_GENERATOR) {
      const hemiLight = new THREE.HemisphereLight();
      hemiLight.name = 'hemi_light';
      this.scene.add(hemiLight);
      this.lights.push(hemiLight);
      return;
    }

    const light1  = new THREE.AmbientLight(state.ambientColor, state.ambientIntensity);
    light1.name = 'ambient_light';
    this.defaultCamera.add( light1 );

    const light2  = new THREE.DirectionalLight(state.directColor, state.directIntensity);
    light2.position.set(0.5, 0, 0.866); // ~60º
    light2.name = 'main_light';
    this.defaultCamera.add( light2 );

    this.lights.push(light1, light2);
  }

  removeLights () {

    this.lights.forEach((light) => light.parent.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment () {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

    this.getCubeMapTexture( environment ).then(( { envMap, cubeMap } ) => {

      if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
        this.scene.add(this.background);
      } else {
        this.scene.remove(this.background);
      }

      traverseMaterials(this.content, (material) => {
        if (material.isMeshStandardMaterial || material.isGLTFSpecularGlossinessMaterial) {
          material.envMap = envMap;
          material.needsUpdate = true;
        }
      });

      this.scene.background = this.state.background ? cubeMap : null;

    });

  }

  getCubeMapTexture (environment) {
    const {path, format} = environment;

    // no envmap
    if ( ! path ) return Promise.resolve({envMap: null, cubeMap: null});

    const cubeMapURLs = [
      path + 'posx' + format, path + 'negx' + format,
      path + 'posy' + format, path + 'negy' + format,
      path + 'posz' + format, path + 'negz' + format
    ];

    // hdr
    if ( format === '.hdr' ) {

      return new Promise((resolve) => {

        new THREE.HDRCubeTextureLoader().load( THREE.UnsignedByteType, cubeMapURLs, ( hdrCubeMap ) => {

          var pmremGenerator = new THREE.PMREMGenerator( hdrCubeMap );
          pmremGenerator.update( this.renderer );

          var pmremCubeUVPacker = new THREE.PMREMCubeUVPacker( pmremGenerator.cubeLods );
          pmremCubeUVPacker.update( this.renderer );

          resolve( {
            envMap: pmremCubeUVPacker.CubeUVRenderTarget.texture,
            cubeMap: hdrCubeMap
          } );

        } );

      });

    }

    // standard
    const envMap = new THREE.CubeTextureLoader().load(cubeMapURLs);
    envMap.format = THREE.RGBFormat;
    return Promise.resolve( { envMap, cubeMap: envMap } );

  }

  updateDisplay () {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    traverseMaterials(this.content, (material) => {
      material.wireframe = this.state.wireframe;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new THREE.GridHelper();
        this.axesHelper = new THREE.AxesHelper();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
      }
    }
  }

  updateBackground () {
    this.background.style({colors: [this.state.bgColor1, this.state.bgColor2]});
  }

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260, hideable: true});

    // Display controls.
    const dispFolder = gui.addFolder('显示');
    const axisHelper = dispFolder.add(this.state, '显示坐标');
    axisHelper.onChange(() => this.updateDisplay());
    const envBackgroundCtrl = dispFolder.add(this.state, 'background');
    envBackgroundCtrl.onChange(() => this.updateEnvironment());
    const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
    wireframeCtrl.onChange(() => this.updateDisplay());
    const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
    skeletonCtrl.onChange(() => this.updateDisplay());
    const gridCtrl = dispFolder.add(this.state, 'grid');
    gridCtrl.onChange(() => this.updateDisplay());
    dispFolder.add(this.controls, 'autoRotate');
    dispFolder.add(this.controls, 'screenSpacePanning');
    const bgColor1Ctrl = dispFolder.addColor(this.state, 'bgColor1');
    const bgColor2Ctrl = dispFolder.addColor(this.state, 'bgColor2');
    bgColor1Ctrl.onChange(() => this.updateBackground());
    bgColor2Ctrl.onChange(() => this.updateBackground());

    // Lighting controls.
    const lightFolder = gui.addFolder('灯光');
    const encodingCtrl = lightFolder.add(this.state, 'textureEncoding', ['sRGB', 'Linear']);
    encodingCtrl.onChange(() => this.updateTextureEncoding());
    lightFolder.add(this.renderer, 'gammaOutput').onChange(() => {
      traverseMaterials(this.content, (material) => {
        material.needsUpdate = true;
      });
    });
    const envMapCtrl = lightFolder.add(this.state, 'environment', environments.map((env) => env.name));
    envMapCtrl.onChange(() => this.updateEnvironment());
    [
      lightFolder.add(this.state, 'exposure', 0, 2),
      lightFolder.add(this.state, 'addLights').listen(),
      lightFolder.add(this.state, 'ambientIntensity', 0, 2),
      lightFolder.addColor(this.state, 'ambientColor'),
      lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
      lightFolder.addColor(this.state, 'directColor')
    ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

    const guiCube = gui.addFolder("摄像头");
    [
      guiCube.add(this.state, '水平角度旋转', -6.28, 6.28),
      guiCube.add(this.state, '垂直角度旋转', -6.28, 6.28),
      guiCube.add(this.state, '坐标X', -20, 20),
      guiCube.add(this.state, '坐标Y', 0, 20),
      guiCube.add(this.state, '坐标Z', -20, 20)
    ].forEach((ctrl) => ctrl.onChange(() => this.updateRotation()));

    // // Animation controls.
    // this.animFolder = gui.addFolder('Animation');
    // this.animFolder.domElement.style.display = 'none';
    // const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
    // playbackSpeedCtrl.onChange((speed) => {
    //   if (this.mixer) this.mixer.timeScale = speed;
    // });
    // this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

    // // Morph target controls.
    // this.morphFolder = gui.addFolder('Morph Targets');
    // this.morphFolder.domElement.style.display = 'none';

    // // Camera controls.
    // this.cameraFolder = gui.addFolder('Cameras');
    // this.cameraFolder.domElement.style.display = 'none';

    // // Stats.
    // const perfFolder = gui.addFolder('Performance');
    // const perfLi = document.createElement('li');
    // this.stats.dom.style.position = 'static';
    // perfLi.appendChild(this.stats.dom);
    // perfLi.classList.add('gui-stats');
    // perfFolder.__ul.appendChild( perfLi );

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();

  }

  updateRotation () {
    const state = this.state;
    if (this.selectedObject) {
      console.log("水平角度旋转:" + state.水平角度旋转);
      console.log("水平角度旋转:" + state.垂直角度旋转);
      console.log("坐标X:" + state.坐标X);
      console.log("坐标Y:" + state.坐标Y);
      console.log("坐标Z:" + state.坐标Z);

      this.selectedObject.rotation.z = state.水平角度旋转;
      this.selectedObject.rotation.y = state.垂直角度旋转;
   
      this.selectedObject.position.x = state.坐标X;
      this.selectedObject.position.y = state.坐标Y;
      this.selectedObject.position.z = state.坐标Z;

    }
  }

  updateGUI () {
    this.cameraFolder.domElement.style.display = 'none';

    this.morphCtrls.forEach((ctrl) => ctrl.remove());
    this.morphCtrls.length = 0;
    this.morphFolder.domElement.style.display = 'none';

    this.animCtrls.forEach((ctrl) => ctrl.remove());
    this.animCtrls.length = 0;
    this.animFolder.domElement.style.display = 'none';

    const cameraNames = [];
    const morphMeshes = [];
    this.content.traverse((node) => {
      if (node.isMesh && node.morphTargetInfluences) {
        morphMeshes.push(node);
      }
      if (node.isCamera) {
        node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
        cameraNames.push(node.name);
      }
    });

    if (cameraNames.length) {
      this.cameraFolder.domElement.style.display = '';
      if (this.cameraCtrl) this.cameraCtrl.remove();
      const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
      this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
      this.cameraCtrl.onChange((name) => this.setCamera(name));
    }

    if (morphMeshes.length) {
      this.morphFolder.domElement.style.display = '';
      morphMeshes.forEach((mesh) => {
        if (mesh.morphTargetInfluences.length) {
          const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
          this.morphCtrls.push(nameCtrl);
        }
        for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
          const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1, 0.01).listen();
          Object.keys(mesh.morphTargetDictionary).forEach((key) => {
            if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
          });
          this.morphCtrls.push(ctrl);
        }
      });
    }

    if (this.clips.length) {
      this.animFolder.domElement.style.display = '';
      const actionStates = this.state.actionStates = {};
      this.clips.forEach((clip, clipIndex) => {
        // Autoplay the first clip.
        let action;
        if (clipIndex === 0) {
          actionStates[clip.name] = true;
          action = this.mixer.clipAction(clip);
          action.play();
        } else {
          actionStates[clip.name] = false;
        }

        // Play other clips when enabled.
        const ctrl = this.animFolder.add(actionStates, clip.name).listen();
        ctrl.onChange((playAnimation) => {
          action = action || this.mixer.clipAction(clip);
          action.setEffectiveTimeScale(1);
          playAnimation ? action.play() : action.stop();
        });
        this.animCtrls.push(ctrl);
      });
    }
  }

  clear () {

    if ( !this.content ) return;

    this.scene.remove( this.content );

    // dispose geometry
    this.content.traverse((node) => {

      if ( !node.isMesh ) return;

      node.geometry.dispose();

    } );

    // dispose textures
    traverseMaterials( this.content, (material) => {

      MAP_NAMES.forEach( (map) => {

        if (material[ map ]) material[ map ].dispose();

      } );

    } );

  }

};

function traverseMaterials (object, callback) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach(callback);
  });
}
