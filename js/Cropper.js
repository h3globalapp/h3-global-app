{
  aspectRatio: 1,           // Square (1:1)
  viewMode: 1,              // Restrict crop box to canvas
  dragMode: 'move',         // Drag image to position
  autoCropArea: 0.8,        // Initial crop size (80% of image)
  restore: false,
  guides: false,
  center: true,
  highlight: false,
  cropBoxMovable: true,
  cropBoxResizable: true,
  toggleDragModeOnDblclick: false,
  minCropBoxWidth: 200,     // Minimum size
  minCropBoxHeight: 200,
  ready: function() {
    // Apply circular mask via CSS
    this.cropper.setCropBoxData({
      width: Math.min(200, this.cropper.getContainerData().width),
      height: Math.min(200, this.cropper.getContainerData().height)
    });
  }
}