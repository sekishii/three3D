var fs = require('fs');
// var domify = require('domify');

var blob = fs.readFileSync(__dirname + '/model.gltf', 'utf8');
document.addEventListener('DOMContentLoaded', function() {
	var modal = document.createElement('input');
	modal.setAttribute("type", "hidden");
	modal.setAttribute("class", "modal");
	modal.setAttribute("id", "modal");
	modal.setAttribute("value", blob);
  	document.body.appendChild(modal);
});


var blob2 = fs.readFileSync(__dirname + '/model2.gltf', 'utf8');
document.addEventListener('DOMContentLoaded', function() {
	var modal = document.createElement('input');
	modal.setAttribute("type", "hidden");
	modal.setAttribute("class", "modal");
	modal.setAttribute("id", "modal2");
	modal.setAttribute("value", blob2);
	// modal.value=blob;
  	document.body.appendChild(modal);
});


var cameraInfo = fs.readFileSync(__dirname + '/camera.json', 'utf8');
document.addEventListener('DOMContentLoaded', function() {

  	var modal = document.createElement('input');
	modal.setAttribute("type", "hidden");
	modal.setAttribute("class", "camera");
	modal.setAttribute("style", "cursor:hand");
	modal.setAttribute("id", "camera");
	modal.setAttribute("value", cameraInfo);
	// modal.value=blob;
  	document.body.appendChild(modal);
});