const THREE = window.THREE = require('three');
const Stats = require('../lib/stats.min');
const dat = require('dat.gui');
const waitUntil = require('wait-until');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');
const fs = require('fs');

require('three/examples/js/exporters/GLTFExporter');
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
    this.modelCount = 0;

    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
        ? 'Footprint Court (HDR)'
        : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      线框图: false,
      skeleton: false,
      grid: false,

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      环境光强度: 1.7,
      环境光颜色: 0xFFFFFF,
      光强度: 0.8 * Math.PI, // TODO(#116)
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
    this.hiding = null;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    const fov = options.preset === Preset.ASSET_GENERATOR
      ? 0.8 * 180 / Math.PI
      : 60;
    this.defaultCamera = new THREE.PerspectiveCamera( fov, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.defaultCamera.position.set( 400, 200, 0 );
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
    // this.controls = new THREE.TrackballControls( this.defaultCamera, this.renderer.domElement );
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

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    // window.addEventListener('resize', this.resize.bind(this), false);

    /////////////////////////////////

    this.link = document.createElement( 'a' );
    this.link.style.display = 'none';
    document.body.appendChild( this.link );

    // // 读取外部JSON数据设置内部相机模型
    // var dataJson = JSON.parse(this.cameraContent);
    // // console.log(dataJson);
    // console.log(dataJson.camears);
    // self.initGeometry2(dataJson.camears);
    console.log("point1");
    this.scene.add( this.group );


    var subModal = document.createElement('input');
    subModal.setAttribute("type", "hidden");
    subModal.setAttribute("class", "modal");
    subModal.setAttribute("id", "selectedModal");
    document.body.appendChild(subModal);

    document.getElementById( 'export_scenes' ).addEventListener( 'click', function () {
      var exporter = new THREE.GLTFExporter();
      // self.scenes.push(self.scene);
      exporter.parse( self.scene, function ( gltf ) {

        // console.log( self.scene );
        var output = JSON.stringify( gltf, null, 2 );
        var outputJson = {
          "camears" : self.cameraArray
        }
        var modalOutput = JSON.stringify( outputJson, null, 2 );
        // console.log( output );
        self.saveString(output, modalOutput, 'model_exp.gltf' );
      }, null );
    } );

    var canvass = document.getElementsByTagName( 'canvas' );
    console.log("ttttttqqqqq:  "+ canvass.length);
    for(var i=0;i<canvass.length;i++) {
        canvass[i].addEventListener( 'mouseover', function () {
          console.log("qqqq");
        });
    }

    this.renderer.domElement.addEventListener("mousedown", mousedown);
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    function mousedown(e) {
      mouse.x = e.clientX / renderer.domElement.clientWidth * 2 - 1;
      mouse.y = -(e.clientY / renderer.domElement.clientHeight * 2) + 1;
      raycaster.setFromCamera(mouse, this.defaultCamera);
      var intersects = raycaster.intersectObjects(this.scene.children);
      if (intersects.length > 0) {
        console.log("testqzw111");
        console.log(intersects[0].object);
      } else {
        console.log("testqzw222");
      }
    }
    

    document.getElementById( 'add_modal' ).addEventListener( 'click', function () {
      self.initGeometry2(null);
    } );

    this.renderer.domElement.addEventListener('dblclick', function (event) {

        // console.log("test");
        var x = (event.layerX / window.innerWidth) * 2 - 1;
        var y = -(event.layerY / window.innerHeight) * 2 + 1;
        var mouseVector = new THREE.Vector3(x, y, 0.5);
        // var mouseVector = new THREE.Vector2(x, y);

        // console.log("-------------");
        // console.log(event.layerX);
        // console.log(event.layerY);
        var raycaster = new THREE.Raycaster();
        // var raycaster = new THREE.Raycaster(self.defaultCamera.position, mouseVector.sub(self.defaultCamera.position).normalize());

        raycaster.setFromCamera(mouseVector, self.defaultCamera);
        self.render();
        // raycaster.setFromCamera( mouseVector, self.defaultCamera );
        // console.log(self.group);
        console.log(raycaster);

        var intersects = raycaster.intersectObjects(self.group.children, true);
        // console.log(self.group);

        // console.log("length:" + intersects.length);

        if (intersects.length > 0 && self.selectedObject != intersects[0].object) {

            console.log("there is no selectedObject");

        } else {
            console.log("test22");
            if (self.selectedObject) {
                // alert("qzw");
                console.log("test11");
                self.selectedObject.material.emissive.setHex(0x000000);
                self.selectedObject = null;
            }

            var infoDiv = document.querySelector('#selectedModal');
            infoDiv.value = "";
        }
    });

    this.renderer.domElement.addEventListener( 'click', function (event) {

      var viewer = document.querySelector("canvas");
      console.log(viewer.style);
      var innerWidth = parseInt(viewer.style.width);
      var innerHeight = parseInt(viewer.style.height);
      console.log(event);
      console.log("innerWidth: " + innerWidth);
      console.log("innerHeight: " + innerHeight);
      console.log("window_innerWidth: " + window.innerWidth);
      console.log("window_innerHeight: " + window.innerHeight);
      // var layerY = event.layerY - ((window.innerHeight - innerHeight) / 2);
      console.log("event.layerX: " + event.layerX);
      console.log("event.layerY: " + event.layerY);
      // console.log(layerY);

      // var x = ( event.layerX / window.innerWidth ) * 2 - 1;
      // var y = - ( event.layerY / window.innerHeight ) * 2 + 1;

      var x = ( event.layerX / innerWidth ) * 2 - 1;
      var y = - ( event.layerY / innerHeight ) * 2 + 1;

      var mouseVector = new THREE.Vector3(x, y, 0.5);
      // var mouseVector = new THREE.Vector2(x, y);
      var raycaster = new THREE.Raycaster();

      raycaster.setFromCamera( mouseVector, self.defaultCamera );
       self.render();
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
              // console.log(self.selectedObject.uuid);
              self.selectedObject.material.emissive.setHex( 0xffd700 );

              var infoDiv = document.querySelector('#selectedModal');
              var info = res.object;
              // infoDiv.value = info.position.x + "\n" + info.position.y + "\n" + info.position.z;

              var outModalInfo = {
                "id" : info.cust_id,
                "name" : info.cust_name,
                "type" : info.cust_type,
                "position_x" : info.position.x,
                "position_y" : info.position.y,
                "position_z" : info.position.z,
                "rotation_x" : info.rotation.x,
                "rotation_y" : info.rotation.y,
                "rotation_z" : info.rotation.z
              }
              var outInfo = JSON.stringify( outModalInfo, null, 2 );
              console.log(outInfo);
              infoDiv.value = outInfo;
              // alert(infoDiv.value);

              self.objects.length = 0;
              self.objects.push(res.object);
              var dragControls = new THREE.DragControls( self.objects, self.defaultCamera, self.renderer.domElement );
              // dragControls.enabled = false;
              dragControls.addEventListener( 'dragstart', function (event) {
                
                self.controls.enabled = false;
              } );
              dragControls.addEventListener( 'dragend', function (event) {
                console.log(event.object);
                console.log(event.object.uuid);
                console.log(self.cameraArray);
                self.updatePosition(event.object, self.cameraArray);

                var target = event.object
                var infoDiv = document.querySelector('#selectedModal');
                var outModalInfo = {
                  "id" : target.cust_id,
                  "name" : target.cust_name,
                  "type" : target.cust_type,
                  "position_x" : target.position.x,
                  "position_y" : target.position.y,
                  "position_z" : target.position.z,
                  "rotation_x" : target.rotation.x,
                  "rotation_y" : target.rotation.y,
                  "rotation_z" : target.rotation.z
                }
                var outInfo = JSON.stringify( outModalInfo, null, 2 );
                console.log(outInfo);
                infoDiv.value = outInfo;

                self.controls.enabled = true;
              } );

          }
          // intersects[0].object.material.color.set( '#ff0' );
      } 

    } );

    console.log("point2");
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

  updatePosition(object, cameraArray) {
    cameraArray.forEach(function(item, index) {
      if (object.uuid == item.uuid) {
        console.log("drag changed");
        item.rotation_x = object.rotation.x;
        item.rotation_y = object.rotation.y;
        item.rotation_z = object.rotation.z;
        item.position_x = object.position.x;
        item.position_y = object.position.y;
        item.position_z = object.position.z;
      }
    });
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
                    object.castShadow = true;
                    // var color = new THREE.Color();
                    // color.setHex( 0xFFFF00 );
                    // object.material = new THREE.MeshStandardMaterial();
                    // console.log(object.material.color.getHex());
                    self.objects.push(object);
                    // self.group.add(object);
                    item.uuid = object.uuid; 

                    object.cust_id = item.id;
                    object.cust_name = item.name;
                    object.cust_type = item.type;

                    object.rotation.x = item.rotation_x;
                    object.rotation.y = item.rotation_y;
                    object.rotation.z = item.rotation_z;
                    object.position.x = item.position_x;
                    object.position.y = item.position_y;
                    object.position.z = item.position_z;
                    object.scale.set(0.005, 0.005, 0.005);
                    console.log(object);
                }
            });

            // model.rotation.x = item.rotation_x;
            // model.rotation.y = item.rotation_y;
            // model.rotation.z = item.rotation_z;
            // model.position.x = item.position_x;
            // model.position.y = item.position_y;
            // model.position.z = item.position_z;
           
            // model.scale.set(2.22, 2.22, 2.22);

            // self.group.add(model);

            const encoding = THREE.sRGBEncoding;
            traverseMaterials(model, (material) => {
              if (material.map) material.map.encoding = encoding;
              if (material.emissiveMap) material.emissiveMap.encoding = encoding;
              if (material.map || material.emissiveMap) material.needsUpdate = true;
            });

            self.scene.add(model);

            var groupChild = new THREE.Group();
            groupChild.add(model);
            self.group.add(groupChild);

            self.cameraArray.push(item);

        },

        function ( xhr ) {
          console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
          if (xhr.loaded / xhr.total == 1) {
            console.log("load completed");
            self.modelCount = self.modelCount + 1;
            // self.render();
          }
        },
        function ( error ) {

          console.log( 'An error happened' );
          console.log( error );

        });
      });
    } else {

    loader.load('img/yangan.gltf', function (gltf) {
        
        var model = gltf.scene;
        var uuid = "";
        model.traverse(function (object) {
            if (object.isMesh) {
                // object.castShadow = true;
                // object.material = new THREE.MeshStandardMaterial();
                console.log(object);
                self.objects.push(object);
                // self.group.add(object);
                uuid = object.uuid;

                object.rotation.x = 0;
                object.rotation.y = Math.random() * 2 * Math.PI;;
                object.rotation.z = -0.2 * Math.PI;
                object.position.x = 0;
                object.position.y = Math.random() * 0.5;
                // model.position.z = Math.random() * (50 - 0) - 25;
                object.position.z = 0;
                // object.scale.set(0.02, 0.02, 0.02);
            }
        });

        // model.rotation.x = 0;
        // model.rotation.y = Math.random() * 2 * Math.PI;;
        // model.rotation.z = -0.2 * Math.PI;
        // model.position.x = 0;
        // model.position.y = Math.random() * 0.5;
        // // model.position.z = Math.random() * (50 - 0) - 25;
        // model.position.z = 0;
        // model.scale.set(0.22, 0.22, 0.22);

        // self.group.add(model);
        self.scene.add(model);

        var groupChild = new THREE.Group();
        groupChild.add(model);
        self.group.add(groupChild);
        // self.group.add(model);
       
        var camera = {
          "id"  : (self.cameraArray.length + 1),
          "name" : "camera" + (self.cameraArray.length + 1 ),
          "type" : "qiangji",
          "rotation_x" : model.rotation.x,
          "rotation_y" : model.rotation.y,
          "rotation_z" : model.rotation.z,
          "position_x" : model.position.x,
          "position_y" : model.position.y,
          "position_z" : model.position.z,
          "uuid"       : uuid
        };
        self.cameraArray.push(camera);
      }); 
    }


    console.log(self.cameraArray);
    

    // var dragControls = new THREE.DragControls( this.objects, this.defaultCamera, this.renderer.domElement );
    // // dragcontrols.enabled = false;
    // dragControls.addEventListener( 'dragstart', function (event) {
    //   console.log(event.object.uuid);
    //   console.log(self.selectedObject);
    //   if (self.selectedObject != null && event.object.uuid == self.selectedObject.uuid ) {
    //     self.controls.enabled = false;
    //   } else {
    //     // event.preventDefault();
    //     self.controls.enabled = true;
    //     return false;
    //   }
      
    // } );
    // dragControls.addEventListener( 'dragend', function (event) {
    //   if (self.selectedObject != null && event.object.uuid == self.selectedObject.uuid ) {
    //     self.controls.enabled = false;
    //   } else {
    //     // event.preventDefault();
    //     self.controls.enabled = true;
    //     return false;
    //   }
    // } );

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

  load ( url, rootPath, assetMap, cameraContent) {

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

      // const loader = new THREE.GLTFLoader();
      // loader.setCrossOrigin('anonymous');
      // loader.setDRACOLoader( new THREE.DRACOLoader() );
      // const blobURLs = [];

      // console.log('URL:' + url);
      // url = 'img/model2.gltf'

      // 读取外部JSON数据设置内部相机模型
      // this.modelCount = 5;
      var dataJson = JSON.parse(this.cameraContent);
      // console.log(dataJson);
      console.log(dataJson.camears);
      this.initGeometry2(dataJson.camears);

      let self = this;
      // setTimeout(
      //   function callback() {
      //     console.log("this.modelCount:" + self.modelCount);
      //     if(self.modelCount == 5) {

      //       window.content = self.content;
      //       console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
      //       self.printGraph(self.content);
           
      //       // i++;
      //     } else {
      //       console.log("await"); 
      //     }
      //   },
      //   1000
      // );


      // waitUntil()
      //   .interval(500)
      //   .times(10)
      //   .condition(function() {
      //       return (self.modelCount == 5 ? true : false);
      //   })
      //   .done(function(result) {
      //       console.log("start!!!!!");
      //       // do stuff 
      //       const loader = new THREE.GLTFLoader();
      //       loader.setCrossOrigin('anonymous');
      //       loader.setDRACOLoader( new THREE.DRACOLoader() );
      //       const blobURLs = [];

      //       loader.load(url, (gltf) => {

      //         const scene = gltf.scene || gltf.scenes[0];
      //         const clips = gltf.animations || [];
      //         self.setContent(scene, clips);

      //         blobURLs.forEach(URL.revokeObjectURL);

      //         // See: https://github.com/google/draco/issues/349
      //         // THREE.DRACOLoader.releaseDecoderModule();

      //         resolve(gltf);

      //       }, undefined, reject);
      //   });



      const loader = new THREE.GLTFLoader();
      loader.setCrossOrigin('anonymous');
      loader.setDRACOLoader( new THREE.DRACOLoader() );
      const blobURLs = [];

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

    // // 读取外部JSON数据设置内部相机模型
    // // this.modelCount = 5;
    // var dataJson = JSON.parse(this.cameraContent);
    // // console.log(dataJson);
    // console.log(dataJson.camears);
    // this.initGeometry2(dataJson.camears);

    // let self = this;
    // setTimeout(
    //   function callback() {
    //     console.log("this.modelCount:" + self.modelCount);
    //     if(self.modelCount == 5) {

    //       window.content = self.content;
    //       console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    //       self.printGraph(self.content);
         
    //       // i++;
    //     } else {
    //       console.log("await"); 
    //     }
    //   },
    //   1000
    // );

    window.content = this.content;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    this.printGraph(this.content);

  }

  printGraph (node) {

    // console.group(' <' + node.type + '> ' + node.name);
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
      lights[0].intensity = state.环境光强度;
      lights[0].color.setHex(state.环境光颜色);
      lights[1].intensity = state.光强度;
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

    const light1  = new THREE.AmbientLight(state.环境光颜色, state.环境光强度);
    light1.name = 'ambient_light';
    this.defaultCamera.add( light1 );

    const light2  = new THREE.DirectionalLight(state.directColor, state.光强度);
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
      material.wireframe = this.state.线框图;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.显示坐标 !== Boolean(this.gridHelper)) {
      if (this.state.显示坐标) {
        this.gridHelper = new THREE.GridHelper(100,100);
        this.axesHelper = new THREE.AxesHelper(50);
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

    const gui = this.gui = new dat.GUI({autoPlace: true, width: 260, hideable: false});

    // Display controls.
    const dispFolder = gui.addFolder('显示');
    // const envBackgroundCtrl = dispFolder.add(this.state, 'background');
    // envBackgroundCtrl.onChange(() => this.updateEnvironment());
    const axisHelper = dispFolder.add(this.state, '显示坐标');
    axisHelper.onChange(() => this.updateDisplay());

    const wireframeCtrl = dispFolder.add(this.state, '线框图');
    wireframeCtrl.onChange(() => this.updateDisplay());
    // const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
    // skeletonCtrl.onChange(() => this.updateDisplay());
    // const gridCtrl = dispFolder.add(this.state, 'grid');
    // gridCtrl.onChange(() => this.updateDisplay());
    dispFolder.add(this.controls, 'autoRotate');
    // dispFolder.add(this.controls, 'screenSpacePanning');
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
      lightFolder.add(this.state, '环境光强度', 0, 2),
      lightFolder.addColor(this.state, '环境光颜色'),
      lightFolder.add(this.state, '光强度', 0, 4), // TODO(#116)
      lightFolder.addColor(this.state, 'directColor')
    ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
    playbackSpeedCtrl.onChange((speed) => {
      if (this.mixer) this.mixer.timeScale = speed;
    });
    this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

    // Morph target controls.
    this.morphFolder = gui.addFolder('Morph Targets');
    this.morphFolder.domElement.style.display = 'none';

    // Camera controls.
    this.cameraFolder = gui.addFolder('Cameras');
    this.cameraFolder.domElement.style.display = 'none';

    // Stats.
    // const perfFolder = gui.addFolder('Performance');
    // const perfLi = document.createElement('li');
    // this.stats.dom.style.position = 'static';
    // perfLi.appendChild(this.stats.dom);
    // perfLi.classList.add('gui-stats');
    // perfFolder.__ul.appendChild( perfLi );

    const guiCube = gui.addFolder("摄像头");
    [
      guiCube.add(this.state, '水平角度旋转', -6.28, 6.28),
      guiCube.add(this.state, '垂直角度旋转', -6.28, 6.28),
      guiCube.add(this.state, '坐标X', -20, 20),
      guiCube.add(this.state, '坐标Y', 0, 20),
      guiCube.add(this.state, '坐标Z', -20, 20)
    ].forEach((ctrl) => ctrl.onChange(() => this.updateRotation()));

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();
  }


  updateRotation () {
    const state = this.state;
    if (this.selectedObject) {
      // console.log("水平角度旋转:" + state.水平角度旋转);
      // console.log("水平角度旋转:" + state.垂直角度旋转);
      // console.log("坐标X:" + state.坐标X);
      // console.log("坐标Y:" + state.坐标Y);
      // console.log("坐标Z:" + state.坐标Z);

      this.selectedObject.rotation.z = state.水平角度旋转;
      this.selectedObject.rotation.y = state.垂直角度旋转;
   
      this.selectedObject.position.x = state.坐标X;
      this.selectedObject.position.y = state.坐标Y;
      this.selectedObject.position.z = state.坐标Z;

      this.updatePosition(this.selectedObject, this.cameraArray);

      var target = this.selectedObject;
      var infoDiv = document.querySelector('#selectedModal');
      var outModalInfo = {
        "id" : target.cust_id,
        "name" : target.cust_name,
        "type" : target.cust_type,
        "position_x" : target.position.x,
        "position_y" : target.position.y,
        "position_z" : target.position.z,
        "rotation_x" : target.rotation.x,
        "rotation_y" : target.rotation.y,
        "rotation_z" : target.rotation.z
      }
      var outInfo = JSON.stringify( outModalInfo, null, 2 );
      console.log(outInfo);
      infoDiv.value = outInfo;

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
    const materials = Array.isArray(node.materials)
      ? node.material
      : [node.material];
    materials.forEach(callback);
  });
}

