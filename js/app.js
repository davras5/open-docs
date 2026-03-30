/**
 * OpenDocs — Single-page document management application
 * Plain vanilla JS, no build tools. Uses globally loaded CDN libs:
 * localForage, Mammoth, XLSX, pdfjsLib, lucide
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants & Helpers
  // ---------------------------------------------------------------------------

  const STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB (display only)

  /** Map file extensions to icon name, color, and category. */
  function getFileType(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const types = {
      // Documents
      docx: { icon: 'file-text', color: '#2B579A', category: 'document' },
      doc:  { icon: 'file-text', color: '#2B579A', category: 'document' },
      // Spreadsheets
      xlsx: { icon: 'sheet', color: '#217346', category: 'spreadsheet' },
      xls:  { icon: 'sheet', color: '#217346', category: 'spreadsheet' },
      csv:  { icon: 'sheet', color: '#217346', category: 'spreadsheet' },
      // Presentations
      pptx: { icon: 'presentation', color: '#B7472A', category: 'presentation' },
      ppt:  { icon: 'presentation', color: '#B7472A', category: 'presentation' },
      // PDFs
      pdf:  { icon: 'file-text', color: '#D32F2F', category: 'pdf' },
      // Images
      png:  { icon: 'image', color: '#7B1FA2', category: 'image' },
      jpg:  { icon: 'image', color: '#7B1FA2', category: 'image' },
      jpeg: { icon: 'image', color: '#7B1FA2', category: 'image' },
      gif:  { icon: 'image', color: '#7B1FA2', category: 'image' },
      svg:  { icon: 'image', color: '#7B1FA2', category: 'image' },
      webp: { icon: 'image', color: '#7B1FA2', category: 'image' },
      bmp:  { icon: 'image', color: '#7B1FA2', category: 'image' },
      // Text / code
      txt:  { icon: 'file-code', color: '#607D8B', category: 'text' },
      md:   { icon: 'file-code', color: '#607D8B', category: 'text' },
      json: { icon: 'file-code', color: '#607D8B', category: 'text' },
      js:   { icon: 'file-code', color: '#F7DF1E', category: 'text' },
      html: { icon: 'file-code', color: '#E44D26', category: 'text' },
      css:  { icon: 'file-code', color: '#264DE4', category: 'text' },
      xml:  { icon: 'file-code', color: '#607D8B', category: 'text' },
      // Archives
      zip:  { icon: 'file-archive', color: '#FFA000', category: 'archive' },
      rar:  { icon: 'file-archive', color: '#FFA000', category: 'archive' },
    };
    return types[ext] || { icon: 'file', color: '#90A4AE', category: 'other' };
  }

  /** Format bytes to human-readable string. */
  function formatSize(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /** Format timestamp to relative or short date string. */
  function formatDate(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    var d = new Date(ts);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /** Simple debounce. */
  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /** Safely get a DOM element by ID. */
  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------------------
  // Storage Engine
  // ---------------------------------------------------------------------------

  var fileStore = localforage.createInstance({ name: 'opendocs', storeName: 'files' });
  var dataStore = localforage.createInstance({ name: 'opendocs', storeName: 'data' });

  var Storage = {
    /**
     * Save a new file (metadata + binary data).
     * @param {Object} metadata - File metadata (without data property).
     * @param {ArrayBuffer} arrayBuffer - File content.
     */
    async saveFile(metadata, arrayBuffer) {
      var id = metadata.id || crypto.randomUUID();
      metadata.id = id;
      metadata.createdAt = metadata.createdAt || Date.now();
      metadata.modifiedAt = Date.now();
      // Store metadata (no binary blob)
      var meta = Object.assign({}, metadata);
      delete meta.data;
      await fileStore.setItem(id, meta);
      if (arrayBuffer) {
        await dataStore.setItem(id, arrayBuffer);
      }
      return meta;
    },

    /** Get file metadata by ID. */
    async getFile(id) {
      return await fileStore.getItem(id);
    },

    /** Get file binary data by ID. */
    async getData(id) {
      return await dataStore.getItem(id);
    },

    /** Partially update file metadata. */
    async updateFile(id, updates) {
      var meta = await fileStore.getItem(id);
      if (!meta) throw new Error('File not found');
      Object.assign(meta, updates, { modifiedAt: Date.now() });
      await fileStore.setItem(id, meta);
      return meta;
    },

    /** Soft-delete a file (move to trash). */
    async deleteFile(id) {
      return await this.updateFile(id, { deleted: true });
    },

    /** Permanently remove a file and its data. */
    async permanentDelete(id) {
      var meta = await fileStore.getItem(id);
      await fileStore.removeItem(id);
      await dataStore.removeItem(id);
      // If it was a folder, recursively delete children
      if (meta && meta.type === 'folder') {
        var keys = await fileStore.keys();
        for (var i = 0; i < keys.length; i++) {
          var child = await fileStore.getItem(keys[i]);
          if (child && child.parentId === id) {
            await this.permanentDelete(keys[i]);
          }
        }
      }
    },

    /** Restore a soft-deleted file. */
    async restoreFile(id) {
      return await this.updateFile(id, { deleted: false });
    },

    /**
     * List files matching criteria.
     * @param {string|null} parentId - Folder ID (null = root).
     * @param {Object} options - { deleted, shared, starred, sortBy, sortOrder }
     */
    async listFiles(parentId, options) {
      options = options || {};
      var results = [];
      await fileStore.iterate(function (value) {
        results.push(value);
      });

      // Filter
      results = results.filter(function (f) {
        // Deleted filter
        if (options.deleted) return f.deleted === true;
        if (!options.deleted && f.deleted) return false;
        // Shared filter
        if (options.shared) return f.shared === true;
        // Recent — all non-deleted files
        if (options.recent) return true;
        // Default: match parent
        return f.parentId === (parentId || null);
      });

      // Sort
      var sortBy = options.sortBy || 'name';
      var sortOrder = options.sortOrder || 'asc';
      results.sort(function (a, b) {
        // Folders always first
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;

        var valA, valB;
        if (sortBy === 'name') {
          valA = (a.name || '').toLowerCase();
          valB = (b.name || '').toLowerCase();
          return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (sortBy === 'modified' || sortBy === 'date') {
          valA = a.modifiedAt || 0;
          valB = b.modifiedAt || 0;
        } else if (sortBy === 'size') {
          valA = a.size || 0;
          valB = b.size || 0;
        } else {
          valA = a.modifiedAt || 0;
          valB = b.modifiedAt || 0;
        }
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      });

      return results;
    },

    /** Search files by name (case-insensitive substring). */
    async searchFiles(query) {
      var q = (query || '').toLowerCase().trim();
      if (!q) return [];
      var results = [];
      await fileStore.iterate(function (value) {
        if (!value.deleted && value.name && value.name.toLowerCase().indexOf(q) !== -1) {
          results.push(value);
        }
      });
      return results;
    },

    /** Sum of all stored file sizes (from metadata). */
    async getStorageUsed() {
      var total = 0;
      await fileStore.iterate(function (value) {
        if (!value.deleted && value.size) total += value.size;
      });
      return total;
    },

    /** Move a file to a different folder. */
    async moveFile(id, newParentId) {
      return await this.updateFile(id, { parentId: newParentId || null });
    },

    /** Build breadcrumb path from root to given folder. */
    async getFolderPath(folderId) {
      var path = [];
      var currentId = folderId;
      while (currentId) {
        var folder = await fileStore.getItem(currentId);
        if (!folder) break;
        path.unshift({ id: folder.id, name: folder.name });
        currentId = folder.parentId;
      }
      return path;
    }
  };

  // ---------------------------------------------------------------------------
  // UI Renderer
  // ---------------------------------------------------------------------------

  var UI = {
    currentFolder: null,
    currentView: localStorage.getItem('opendocs-view') || 'list',
    currentSection: 'my-files',
    selectedFile: null,
    sortBy: 'name',
    sortOrder: 'asc',
    isSearching: false,

    /** Main entry point: render the file list for current folder/section. */
    _renderVersion: 0, // guard against concurrent renders

    async renderFileList() {
      var browser = $('file-browser');
      var emptyState = $('empty-state');
      if (!browser) return;

      // Bump version so stale async calls are discarded
      var thisRender = ++this._renderVersion;

      var options = {
        sortBy: this.sortBy,
        sortOrder: this.sortOrder
      };

      var files;
      if (this.isSearching) {
        files = await Storage.searchFiles($('search-input').value);
      } else if (this.currentSection === 'trash') {
        options.deleted = true;
        files = await Storage.listFiles(null, options);
      } else if (this.currentSection === 'shared') {
        options.shared = true;
        files = await Storage.listFiles(null, options);
      } else if (this.currentSection === 'recent') {
        options.recent = true;
        options.sortBy = 'modified';
        options.sortOrder = 'desc';
        files = await Storage.listFiles(null, options);
        files = files.slice(0, 50); // limit recent to 50
      } else {
        files = await Storage.listFiles(this.currentFolder, options);
      }

      // If a newer render was kicked off while we were waiting, bail out
      if (thisRender !== this._renderVersion) return;

      // Clear previous items AFTER async work, right before painting
      var existing = browser.querySelectorAll('.file-card, .file-row, .file-list-table');
      existing.forEach(function (el) { el.remove(); });

      if (files.length === 0) {
        if (emptyState) {
          emptyState.hidden = false;
          // Customize empty state text per section
          var title = emptyState.querySelector('.empty-state-title');
          var text = emptyState.querySelector('.empty-state-text');
          if (this.currentSection === 'trash') {
            if (title) title.textContent = 'Trash is empty';
            if (text) text.textContent = 'Deleted files will appear here';
          } else if (this.currentSection === 'shared') {
            if (title) title.textContent = 'No shared files';
            if (text) text.textContent = 'Files shared with you will appear here';
          } else if (this.currentSection === 'recent') {
            if (title) title.textContent = 'No recent files';
            if (text) text.textContent = 'Recently accessed files will appear here';
          } else if (this.isSearching) {
            if (title) title.textContent = 'No results found';
            if (text) text.textContent = 'Try a different search term';
          } else {
            if (title) title.textContent = 'No files yet';
            if (text) text.textContent = 'Drop files here or click Upload';
          }
        }
        return;
      }

      if (emptyState) emptyState.hidden = true;

      if (this.currentView === 'grid') {
        var fragment = document.createDocumentFragment();
        files.forEach(function (file) {
          fragment.appendChild(UI.renderFileCard(file));
        });
        browser.appendChild(fragment);
      } else {
        // List view — render as a table
        var table = document.createElement('table');
        table.className = 'file-list-table';
        table.innerHTML =
          '<thead><tr>' +
          '<th class="col-name">Name</th>' +
          '<th class="col-modified">Modified</th>' +
          '<th class="col-size">Size</th>' +
          '</tr></thead>';
        var tbody = document.createElement('tbody');
        files.forEach(function (file) {
          tbody.appendChild(UI.renderFileRow(file));
        });
        table.appendChild(tbody);
        browser.appendChild(table);
      }

      // Re-initialize lucide icons for newly created elements
      lucide.createIcons();

      // Show/hide empty trash button
      var emptyTrashBtn = $('empty-trash-btn');
      if (emptyTrashBtn) {
        emptyTrashBtn.hidden = this.currentSection !== 'trash' || files.length === 0;
      }
    },

    /** Create a grid card DOM element for a file. */
    renderFileCard(file) {
      var card = document.createElement('div');
      card.className = 'file-card' + (this.selectedFile === file.id ? ' selected' : '');
      card.dataset.fileId = file.id;

      var ft = file.type === 'folder'
        ? { icon: 'folder', color: '#FFA000', category: 'folder' }
        : getFileType(file.name);

      card.innerHTML =
        '<div class="file-card-icon" style="color:' + ft.color + '">' +
        '  <i data-lucide="' + ft.icon + '"></i>' +
        '</div>' +
        '<div class="file-card-name" title="' + this._escAttr(file.name) + '">' +
          this._esc(file.name) +
        '</div>' +
        '<div class="file-card-meta">' +
          (file.type === 'folder' ? 'Folder' : formatSize(file.size)) +
          ' &middot; ' + formatDate(file.modifiedAt) +
        '</div>';

      this._bindFileEvents(card, file);
      return card;
    },

    /** Create a list-view table row for a file. */
    renderFileRow(file) {
      var row = document.createElement('tr');
      row.className = 'file-row' + (this.selectedFile === file.id ? ' selected' : '');
      row.dataset.fileId = file.id;

      var ft = file.type === 'folder'
        ? { icon: 'folder', color: '#FFA000', category: 'folder' }
        : getFileType(file.name);

      row.innerHTML =
        '<td class="col-name">' +
        '  <span class="file-row-icon" style="color:' + ft.color + '"><i data-lucide="' + ft.icon + '"></i></span>' +
        '  <span class="file-row-name" title="' + this._escAttr(file.name) + '">' + this._esc(file.name) + '</span>' +
        '</td>' +
        '<td class="col-modified">' + formatDate(file.modifiedAt) + '</td>' +
        '<td class="col-size">' + (file.type === 'folder' ? '--' : formatSize(file.size)) + '</td>';

      this._bindFileEvents(row, file);
      return row;
    },

    /** Attach click / dblclick / contextmenu to a file element. */
    _bindFileEvents(el, file) {
      var self = this;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (file.type === 'folder') {
          self.currentFolder = file.id;
          self.isSearching = false;
          self.renderBreadcrumb();
          self.renderFileList();
        } else {
          self.selectFile(file.id);
          Viewer.open(file);
        }
      });
      // Double click — same behavior (prevents confusion)
      el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
      });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.selectFile(file.id);
        ContextMenu.show(e.clientX, e.clientY, file);
      });
    },

    /** Select a file and highlight it. */
    selectFile(fileId) {
      this.selectedFile = fileId;
      document.querySelectorAll('.file-card.selected, .file-row.selected').forEach(function (el) {
        el.classList.remove('selected');
      });
      var el = document.querySelector('[data-file-id="' + fileId + '"]');
      if (el) el.classList.add('selected');
    },

    /** Render the breadcrumb navigation bar. */
    async renderBreadcrumb() {
      var list = $('breadcrumb-list');
      if (!list) return;
      list.innerHTML = '';

      if (this.isSearching) {
        list.innerHTML = '<li class="breadcrumb-item"><button type="button" disabled>Search Results</button></li>';
        return;
      }

      var sectionNames = {
        'my-files': 'My Files',
        'shared': 'Shared with Me',
        'recent': 'Recent',
        'trash': 'Trash'
      };

      // Root crumb
      var rootLi = document.createElement('li');
      rootLi.className = 'breadcrumb-item';
      var rootBtn = document.createElement('button');
      rootBtn.type = 'button';
      rootBtn.textContent = sectionNames[this.currentSection] || 'My Files';
      rootBtn.addEventListener('click', function () {
        UI.currentFolder = null;
        UI.renderBreadcrumb();
        UI.renderFileList();
      });
      rootLi.appendChild(rootBtn);
      list.appendChild(rootLi);

      // Folder trail
      if (this.currentFolder) {
        var path = await Storage.getFolderPath(this.currentFolder);
        path.forEach(function (crumb, idx) {
          var li = document.createElement('li');
          li.className = 'breadcrumb-item';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = crumb.name;
          if (idx < path.length - 1) {
            btn.addEventListener('click', function () {
              UI.currentFolder = crumb.id;
              UI.renderBreadcrumb();
              UI.renderFileList();
            });
          } else {
            btn.disabled = true;
          }
          li.appendChild(btn);
          list.appendChild(li);
        });
      }
    },

    /** Update the storage usage bar in the sidebar. */
    async updateStorageBar() {
      var used = await Storage.getStorageUsed();
      var pct = Math.min(100, (used / STORAGE_LIMIT) * 100);
      var fill = $('storage-bar-fill');
      var text = $('storage-text');
      if (fill) fill.style.width = pct.toFixed(1) + '%';
      if (text) text.textContent = formatSize(used) + ' of ' + formatSize(STORAGE_LIMIT) + ' used';
    },

    /** Show toast notification. */
    showToast(message, type) {
      type = type || 'info';
      var container = $('toast-container');
      if (!container) return;

      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;

      var icons = { success: 'check-circle', error: 'alert-circle', info: 'info' };
      toast.innerHTML =
        '<i data-lucide="' + (icons[type] || 'info') + '"></i>' +
        '<span>' + this._esc(message) + '</span>';

      container.appendChild(toast);
      lucide.createIcons({ nodes: [toast] });

      // Trigger slide-in
      requestAnimationFrame(function () { toast.classList.add('show'); });

      // Auto-dismiss after 3s
      setTimeout(function () {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', function () { toast.remove(); });
        // Fallback removal
        setTimeout(function () { if (toast.parentNode) toast.remove(); }, 500);
      }, 3000);
    },

    /** Open a modal by ID. */
    openModal(modalId) {
      var modal = $(modalId);
      if (modal) {
        modal.hidden = false;
        // Focus first input if present
        var input = modal.querySelector('input:not([hidden])');
        if (input) setTimeout(function () { input.focus(); }, 50);
      }
    },

    /** Close a modal by ID. */
    closeModal(modalId) {
      var modal = $(modalId);
      if (modal) modal.hidden = true;
    },

    /** Set the active sidebar section. */
    setActiveSection(section) {
      this.currentSection = section;
      this.currentFolder = null;
      this.selectedFile = null;
      this.isSearching = false;

      // Highlight active nav item
      document.querySelectorAll('.nav-item').forEach(function (item) {
        item.classList.toggle('active', item.dataset.nav === section);
      });

      // Show/hide upload and new-folder buttons outside trash/shared/recent
      var showActions = section === 'my-files';
      if ($('upload-btn')) $('upload-btn').style.display = showActions ? '' : 'none';
      if ($('new-folder-btn')) $('new-folder-btn').style.display = showActions ? '' : 'none';

      this.renderBreadcrumb();
      this.renderFileList();
    },

    /** Toggle between grid and list view. */
    toggleView(view) {
      this.currentView = view;
      localStorage.setItem('opendocs-view', view);

      $('grid-view-btn').classList.toggle('active', view === 'grid');
      $('list-view-btn').classList.toggle('active', view === 'list');

      // Toggle class on browser container for CSS layout
      var browser = $('file-browser');
      if (browser) {
        browser.classList.toggle('view-grid', view === 'grid');
        browser.classList.toggle('view-list', view === 'list');
      }

      this.renderFileList();
    },

    /** Hide the preview panel. */
    hidePreview() {
      var panel = $('preview-panel');
      if (panel) panel.hidden = true;
    },

    // -- internal helpers --
    _esc(str) {
      var el = document.createElement('span');
      el.textContent = str;
      return el.innerHTML;
    },
    _escAttr(str) {
      return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  var FileOps = {
    /** Handle file upload from <input> or drag-and-drop FileList. */
    async upload(fileList) {
      if (!fileList || fileList.length === 0) return;

      for (var i = 0; i < fileList.length; i++) {
        var file = fileList[i];
        try {
          var buffer = await file.arrayBuffer();
          var meta = {
            id: crypto.randomUUID(),
            name: file.name,
            type: 'file',
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            parentId: UI.currentFolder || null,
            shared: false,
            sharedWith: [],
            starred: false,
            deleted: false
          };
          await Storage.saveFile(meta, buffer);
        } catch (err) {
          console.error('Upload failed:', err);
          UI.showToast('Failed to upload ' + file.name, 'error');
        }
      }

      UI.showToast(fileList.length === 1
        ? fileList[0].name + ' uploaded'
        : fileList.length + ' files uploaded', 'success');

      UI.renderFileList();
      UI.updateStorageBar();
    },

    /** Download a file by creating a temporary blob URL. */
    async download(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        var data = await Storage.getData(fileId);
        if (!meta || !data) { UI.showToast('File not found', 'error'); return; }

        var blob = new Blob([data], { type: meta.mimeType || 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = meta.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Download failed:', err);
        UI.showToast('Download failed', 'error');
      }
    },

    /** Create a new folder in the current directory. */
    async createFolder(name, parentId) {
      name = (name || '').trim() || 'Untitled Folder';
      try {
        var meta = {
          id: crypto.randomUUID(),
          name: name,
          type: 'folder',
          mimeType: null,
          size: 0,
          parentId: parentId || null,
          shared: false,
          sharedWith: [],
          starred: false,
          deleted: false
        };
        await Storage.saveFile(meta, null);
        UI.showToast('Folder "' + name + '" created', 'success');
        UI.renderFileList();
      } catch (err) {
        console.error('Create folder failed:', err);
        UI.showToast('Failed to create folder', 'error');
      }
    },

    /** Rename a file or folder. */
    async rename(fileId, newName) {
      newName = (newName || '').trim();
      if (!newName) return;
      try {
        await Storage.updateFile(fileId, { name: newName });
        UI.showToast('Renamed to "' + newName + '"', 'success');
        UI.renderFileList();
      } catch (err) {
        console.error('Rename failed:', err);
        UI.showToast('Rename failed', 'error');
      }
    },

    /** Soft-delete (move to trash). */
    async delete(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        await Storage.deleteFile(fileId);
        UI.showToast((meta ? meta.name : 'File') + ' moved to trash', 'info');
        UI.hidePreview();
        UI.selectedFile = null;
        UI.renderFileList();
        UI.updateStorageBar();
      } catch (err) {
        console.error('Delete failed:', err);
        UI.showToast('Delete failed', 'error');
      }
    },

    /** Permanently delete a file. */
    async permanentDelete(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        await Storage.permanentDelete(fileId);
        UI.showToast((meta ? meta.name : 'File') + ' permanently deleted', 'success');
        UI.hidePreview();
        UI.selectedFile = null;
        UI.renderFileList();
        UI.updateStorageBar();
      } catch (err) {
        console.error('Permanent delete failed:', err);
        UI.showToast('Delete failed', 'error');
      }
    },

    /** Restore a file from trash. */
    async restore(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        await Storage.restoreFile(fileId);
        UI.showToast((meta ? meta.name : 'File') + ' restored', 'success');
        UI.renderFileList();
      } catch (err) {
        console.error('Restore failed:', err);
        UI.showToast('Restore failed', 'error');
      }
    },

    /** Open the share modal for a file. */
    async share(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        if (!meta) return;

        // Mark as shared
        await Storage.updateFile(fileId, { shared: true });

        // Populate modal
        var nameEl = $('share-filename');
        if (nameEl) nameEl.textContent = meta.name;

        var linkInput = $('share-link-input');
        if (linkInput) linkInput.value = location.origin + location.pathname + '#shared/' + fileId;

        // Render shared people
        var list = $('share-people-list');
        if (list) {
          list.innerHTML =
            '<li class="share-person">' +
            '  <div class="share-person-avatar">DM</div>' +
            '  <div class="share-person-info">' +
            '    <span class="share-person-name">David Mitchell</span>' +
            '    <span class="share-person-role">Owner</span>' +
            '  </div>' +
            '</li>';
          (meta.sharedWith || []).forEach(function (person) {
            var initials = person.name.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase();
            var li = document.createElement('li');
            li.className = 'share-person';
            li.innerHTML =
              '<div class="share-person-avatar">' + initials + '</div>' +
              '<div class="share-person-info">' +
              '  <span class="share-person-name">' + UI._esc(person.name) + '</span>' +
              '  <span class="share-person-role">Can ' + person.permission + '</span>' +
              '</div>';
            list.appendChild(li);
          });
        }

        UI.openModal('share-modal');
      } catch (err) {
        console.error('Share failed:', err);
        UI.showToast('Failed to open share dialog', 'error');
      }
    },

    /** Copy share link to clipboard. */
    async copyShareLink(fileId) {
      var url = location.origin + location.pathname + '#shared/' + fileId;
      try {
        await navigator.clipboard.writeText(url);
        UI.showToast('Link copied to clipboard', 'success');
      } catch (err) {
        // Fallback
        var input = $('share-link-input');
        if (input) { input.select(); document.execCommand('copy'); }
        UI.showToast('Link copied', 'success');
      }
    },

    /** Empty the entire trash. */
    async emptyTrash() {
      try {
        var trashFiles = await Storage.listFiles(null, { deleted: true });
        for (var i = 0; i < trashFiles.length; i++) {
          await Storage.permanentDelete(trashFiles[i].id);
        }
        UI.showToast('Trash emptied', 'success');
        UI.renderFileList();
        UI.updateStorageBar();
      } catch (err) {
        console.error('Empty trash failed:', err);
        UI.showToast('Failed to empty trash', 'error');
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Preview Engine
  // ---------------------------------------------------------------------------

  var Preview = {
    /** Show preview for a file in the right panel. */
    async show(file) {
      var panel = $('preview-panel');
      var content = $('preview-content');
      var filename = $('preview-filename');
      var metaEl = $('preview-meta');
      if (!panel || !content) return;

      // Set filename
      if (filename) filename.textContent = file.name;

      // Set metadata
      if (metaEl) {
        metaEl.innerHTML =
          '<div class="preview-meta-item"><strong>Size:</strong> ' + formatSize(file.size) + '</div>' +
          '<div class="preview-meta-item"><strong>Modified:</strong> ' + formatDate(file.modifiedAt) + '</div>' +
          '<div class="preview-meta-item"><strong>Type:</strong> ' + (file.mimeType || 'Unknown') + '</div>';
      }

      // Show panel
      panel.hidden = false;

      // Show/hide edit button (only for docx)
      var editBtn = $('preview-edit-btn');
      if (editBtn) {
        var ext = (file.name.split('.').pop() || '').toLowerCase();
        editBtn.style.display = (ext === 'docx' || ext === 'doc') ? '' : 'none';
      }

      // Clear previous content
      content.innerHTML = '<div class="preview-loading"><i data-lucide="loader-2" class="spin"></i> Loading preview...</div>';
      lucide.createIcons({ nodes: [content] });

      // Store file ID on panel for action buttons
      panel.dataset.fileId = file.id;

      try {
        var data = await Storage.getData(file.id);
        var ft = getFileType(file.name);

        if (ft.category === 'document') {
          await this.renderDocx(data, content);
        } else if (ft.category === 'spreadsheet') {
          await this.renderXlsx(data, content);
        } else if (ft.category === 'pdf') {
          await this.renderPdf(data, content);
        } else if (ft.category === 'image') {
          this.renderImage(data, file.mimeType, content);
        } else if (ft.category === 'text') {
          this.renderText(data, content);
        } else {
          this.renderUnsupported(file, content);
        }
      } catch (err) {
        console.error('Preview failed:', err);
        content.innerHTML = '<div class="preview-error">Preview failed to load.</div>';
      }
    },

    /** Render a DOCX file using Mammoth. */
    async renderDocx(arrayBuffer, container) {
      if (typeof mammoth === 'undefined') {
        container.innerHTML = '<div class="preview-error">Mammoth library not loaded.</div>';
        return;
      }
      var result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
      container.innerHTML = '<div class="preview-docx">' + result.value + '</div>';
    },

    /** Render an XLSX file using SheetJS. */
    async renderXlsx(arrayBuffer, container) {
      if (typeof XLSX === 'undefined') {
        container.innerHTML = '<div class="preview-error">XLSX library not loaded.</div>';
        return;
      }
      var workbook = XLSX.read(arrayBuffer, { type: 'array' });
      var firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        container.innerHTML = '<div class="preview-error">No sheets found.</div>';
        return;
      }
      var html = XLSX.utils.sheet_to_html(workbook.Sheets[firstSheet]);
      container.innerHTML = '<div class="preview-xlsx">' + html + '</div>';
    },

    /** Render a PDF using pdf.js — all pages, scrollable. */
    async renderPdf(arrayBuffer, container) {
      if (typeof pdfjsLib === 'undefined') {
        container.innerHTML = '<div class="preview-error">PDF.js library not loaded.</div>';
        return;
      }
      container.innerHTML = '';
      var wrapper = document.createElement('div');
      wrapper.className = 'preview-pdf';
      container.appendChild(wrapper);

      var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var viewport = page.getViewport({ scale: 1.2 });
        var canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        wrapper.appendChild(canvas);

        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: viewport
        }).promise;
      }
    },

    /** Render an image from ArrayBuffer. */
    renderImage(arrayBuffer, mimeType, container) {
      var blob = new Blob([arrayBuffer], { type: mimeType || 'image/png' });
      var url = URL.createObjectURL(blob);
      container.innerHTML = '<div class="preview-image"><img src="' + url + '" alt="Preview"></div>';
    },

    /** Render a text file (txt, md, json, js, css, html, xml, csv). */
    renderText(arrayBuffer, container) {
      var text = new TextDecoder('utf-8').decode(arrayBuffer);
      var pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.textContent = text;
      container.innerHTML = '';
      container.appendChild(pre);
    },

    /** Render an unsupported file type with download prompt. */
    renderUnsupported(file, container) {
      var ft = getFileType(file.name);
      container.innerHTML =
        '<div class="preview-unsupported">' +
        '  <i data-lucide="' + ft.icon + '" style="width:64px;height:64px;color:' + ft.color + '"></i>' +
        '  <h3>' + UI._esc(file.name) + '</h3>' +
        '  <p>Preview not available for this file type.</p>' +
        '  <button class="btn btn-primary preview-download-prompt" type="button">' +
        '    <i data-lucide="download"></i> Download' +
        '  </button>' +
        '</div>';
      lucide.createIcons({ nodes: [container] });

      // Bind download button
      var btn = container.querySelector('.preview-download-prompt');
      if (btn) {
        btn.addEventListener('click', function () { FileOps.download(file.id); });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Editor (simple rich-text editor for DOCX content)
  // ---------------------------------------------------------------------------

  var Editor = {
    currentFileId: null,

    /** Open the editor modal, loading DOCX content as HTML. */
    async open(fileId) {
      try {
        var meta = await Storage.getFile(fileId);
        var data = await Storage.getData(fileId);
        if (!meta || !data) { UI.showToast('File not found', 'error'); return; }

        this.currentFileId = fileId;

        // Set title
        var title = $('editor-modal-title');
        if (title) title.textContent = 'Edit: ' + meta.name;

        // Convert DOCX to HTML
        var editorContent = $('editor-content');
        if (typeof mammoth !== 'undefined') {
          var result = await mammoth.convertToHtml({ arrayBuffer: data });
          editorContent.innerHTML = result.value;
        } else {
          // Fallback: try to render as text
          editorContent.innerHTML = '<p>' + new TextDecoder().decode(data) + '</p>';
        }

        UI.openModal('editor-modal');
      } catch (err) {
        console.error('Editor open failed:', err);
        UI.showToast('Failed to open editor', 'error');
      }
    },

    /** Save the current editor HTML content back to storage. */
    async save() {
      if (!this.currentFileId) return;
      try {
        var editorContent = $('editor-content');
        var html = editorContent.innerHTML;
        // For the prototype, store the HTML directly as file content
        var encoder = new TextEncoder();
        var buffer = encoder.encode(html).buffer;
        await dataStore.setItem(this.currentFileId, buffer);
        await Storage.updateFile(this.currentFileId, { modifiedAt: Date.now() });
        UI.showToast('Document saved', 'success');
        UI.renderFileList();
      } catch (err) {
        console.error('Save failed:', err);
        UI.showToast('Failed to save document', 'error');
      }
    },

    /** Apply a formatting command (bold, italic, underline). */
    applyFormat(command) {
      document.execCommand(command, false, null);
    },

    /** Close the editor modal. */
    close() {
      this.currentFileId = null;
      UI.closeModal('editor-modal');
    }
  };

  // ---------------------------------------------------------------------------
  // Document Viewer Modal
  // ---------------------------------------------------------------------------

  var Viewer = {
    currentFile: null,
    siblingFiles: [],  // files in the same folder (non-folder only)
    currentIndex: -1,

    async open(file) {
      this.currentFile = file;
      var modal = $('viewer-modal');
      var content = $('viewer-content');
      var filename = $('viewer-filename');
      var metaBrief = $('viewer-meta-brief');
      if (!modal || !content) return;

      // Build sibling list for prev/next navigation
      await this._loadSiblings(file);

      // Set header info
      if (filename) filename.textContent = file.name;
      if (metaBrief) {
        metaBrief.textContent = formatSize(file.size) + ' · ' + formatDate(file.modifiedAt);
      }

      // Show/hide action buttons based on file type
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      var editBtn = $('viewer-edit-btn');
      var openWordBtn = $('viewer-open-word-btn');
      if (editBtn) editBtn.style.display = (ext === 'docx' || ext === 'doc') ? '' : 'none';
      if (openWordBtn) openWordBtn.style.display = (ext === 'docx' || ext === 'doc') ? '' : 'none';

      // Update nav arrows
      this._updateNav();

      // Show loading state
      content.innerHTML = '<div class="preview-loading"><i data-lucide="loader-2" class="spin"></i><span>Loading preview...</span></div>';
      modal.hidden = false;
      lucide.createIcons({ nodes: [content] });

      // Scroll body to top
      var body = $('viewer-body');
      if (body) body.scrollTop = 0;

      // Store file ID on modal
      modal.dataset.fileId = file.id;

      try {
        var data = await Storage.getData(file.id);
        var ft = getFileType(file.name);

        if (ft.category === 'document') {
          await this.renderDocx(data, content);
        } else if (ft.category === 'spreadsheet') {
          await this.renderXlsx(data, content);
        } else if (ft.category === 'pdf') {
          await this.renderPdf(data, content);
        } else if (ft.category === 'image') {
          this.renderImage(data, file.mimeType, content);
        } else if (ft.category === 'text') {
          this.renderText(data, file.name, content);
        } else {
          this.renderUnsupported(file, content);
        }
      } catch (err) {
        console.error('Viewer failed:', err);
        content.innerHTML = '<div class="preview-unsupported"><h3>Preview failed</h3><p>Could not load the document preview.</p></div>';
      }
    },

    close() {
      var modal = $('viewer-modal');
      if (modal) modal.hidden = true;
      this.currentFile = null;
      this.siblingFiles = [];
      this.currentIndex = -1;
    },

    async prev() {
      if (this.currentIndex > 0) {
        await this.open(this.siblingFiles[this.currentIndex - 1]);
      }
    },

    async next() {
      if (this.currentIndex < this.siblingFiles.length - 1) {
        await this.open(this.siblingFiles[this.currentIndex + 1]);
      }
    },

    async _loadSiblings(file) {
      // Get all non-folder files in the same parent
      var allFiles = await Storage.listFiles(file.parentId, {
        sortBy: UI.sortBy, sortOrder: UI.sortOrder
      });
      this.siblingFiles = allFiles.filter(function (f) { return f.type !== 'folder'; });
      this.currentIndex = -1;
      for (var i = 0; i < this.siblingFiles.length; i++) {
        if (this.siblingFiles[i].id === file.id) { this.currentIndex = i; break; }
      }
    },

    _updateNav() {
      var prevBtn = $('viewer-prev-btn');
      var nextBtn = $('viewer-next-btn');
      var counter = $('viewer-file-counter');

      if (prevBtn) prevBtn.hidden = this.currentIndex <= 0;
      if (nextBtn) nextBtn.hidden = this.currentIndex >= this.siblingFiles.length - 1;
      if (counter && this.siblingFiles.length > 1) {
        counter.textContent = (this.currentIndex + 1) + ' of ' + this.siblingFiles.length;
      } else if (counter) {
        counter.textContent = '';
      }
    },

    async renderDocx(arrayBuffer, container) {
      if (typeof mammoth === 'undefined') {
        container.innerHTML = '<div class="preview-unsupported"><h3>Preview unavailable</h3><p>Document viewer library not loaded.</p></div>';
        return;
      }
      var result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
      container.innerHTML = '<div class="preview-docx">' + result.value + '</div>';
    },

    async renderXlsx(arrayBuffer, container) {
      if (typeof XLSX === 'undefined') {
        container.innerHTML = '<div class="preview-unsupported"><h3>Preview unavailable</h3><p>Spreadsheet viewer library not loaded.</p></div>';
        return;
      }
      var workbook = XLSX.read(arrayBuffer, { type: 'array' });
      var firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        container.innerHTML = '<div class="preview-unsupported"><h3>Empty spreadsheet</h3><p>No sheets found in this file.</p></div>';
        return;
      }
      var html = XLSX.utils.sheet_to_html(workbook.Sheets[firstSheet]);
      container.innerHTML = '<div class="preview-xlsx">' + html + '</div>';
    },

    async renderPdf(arrayBuffer, container) {
      if (typeof pdfjsLib === 'undefined') {
        container.innerHTML = '<div class="preview-unsupported"><h3>Preview unavailable</h3><p>PDF viewer library not loaded.</p></div>';
        return;
      }
      container.innerHTML = '';
      var wrapper = document.createElement('div');
      wrapper.className = 'preview-pdf';
      container.appendChild(wrapper);

      var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var viewport = page.getViewport({ scale: 1.5 });
        var canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        wrapper.appendChild(canvas);
        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport: viewport
        }).promise;
      }
    },

    renderImage(arrayBuffer, mimeType, container) {
      var blob = new Blob([arrayBuffer], { type: mimeType || 'image/png' });
      var url = URL.createObjectURL(blob);
      container.innerHTML = '<div class="preview-image"><img src="' + url + '" alt="Preview"></div>';
    },

    renderText(arrayBuffer, filename, container) {
      var text = new TextDecoder('utf-8').decode(arrayBuffer);
      var ext = (filename.split('.').pop() || '').toLowerCase();

      // Render markdown with basic formatting
      if (ext === 'md') {
        container.innerHTML = '<div class="preview-markdown">' + this._renderMarkdown(text) + '</div>';
        return;
      }

      var pre = document.createElement('pre');
      pre.className = 'preview-text';
      pre.textContent = text;
      container.innerHTML = '';
      container.appendChild(pre);
    },

    /** Very basic markdown → HTML renderer for previewing .md files */
    _renderMarkdown(md) {
      var html = md
        // Code blocks (``` ... ```)
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Headings
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        // Unordered list items
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Table rows (basic: | col | col |)
        .replace(/^\|(.+)\|$/gm, function (match, inner) {
          var cells = inner.split('|').map(function (c) { return c.trim(); });
          return '<tr>' + cells.map(function (c) {
            return '<td>' + c + '</td>';
          }).join('') + '</tr>';
        })
        // Remove markdown table separator rows (|---|---|)
        .replace(/<tr>(<td>-+<\/td>)+<\/tr>/g, '')
        // Wrap consecutive <tr> in <table>
        .replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')
        // Wrap consecutive <li> in <ul>
        .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
        // Paragraphs: lines that aren't already HTML tags
        .replace(/^(?!<[a-z/])(.+)$/gm, '<p>$1</p>');
      return html;
    },

    renderUnsupported(file, container) {
      var ft = getFileType(file.name);
      container.innerHTML =
        '<div class="preview-unsupported">' +
        '  <i data-lucide="' + ft.icon + '" style="width:64px;height:64px;color:' + ft.color + '"></i>' +
        '  <h3>' + UI._esc(file.name) + '</h3>' +
        '  <p>Preview not available for this file type.</p>' +
        '  <button class="btn btn-primary" id="viewer-unsupported-download" type="button">' +
        '    <i data-lucide="download"></i> Download' +
        '  </button>' +
        '</div>';
      lucide.createIcons({ nodes: [container] });
      var btn = $('viewer-unsupported-download');
      if (btn) btn.addEventListener('click', function () { FileOps.download(file.id); });
    }
  };

  // ---------------------------------------------------------------------------
  // Context Menu
  // ---------------------------------------------------------------------------

  var ContextMenu = {
    _menu: null,

    /** Show the context menu at (x, y) for the given file. */
    show(x, y, file) {
      this.hide(); // remove any existing

      var menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';

      var isTrash = UI.currentSection === 'trash';
      var isFolder = file.type === 'folder';
      var items = [];

      if (isTrash) {
        items.push({ label: 'Restore', icon: 'undo-2', action: function () { FileOps.restore(file.id); } });
        items.push({ label: 'Delete Permanently', icon: 'trash-2', action: function () { FileOps.permanentDelete(file.id); }, danger: true });
      } else {
        if (!isFolder) {
          items.push({ label: 'Open / Preview', icon: 'eye', action: function () { Viewer.open(file); } });
          items.push({ label: 'Download', icon: 'download', action: function () { FileOps.download(file.id); } });
        } else {
          items.push({ label: 'Open Folder', icon: 'folder-open', action: function () {
            UI.currentFolder = file.id;
            UI.isSearching = false;
            UI.renderBreadcrumb();
            UI.renderFileList();
          }});
        }
        items.push({ label: 'Rename', icon: 'pencil', action: function () {
          var newName = prompt('Enter new name:', file.name);
          if (newName && newName !== file.name) FileOps.rename(file.id, newName);
        }});
        items.push({ label: 'Share', icon: 'share-2', action: function () { FileOps.share(file.id); } });
        items.push({ type: 'separator' });
        items.push({ label: 'Move to Trash', icon: 'trash-2', action: function () { FileOps.delete(file.id); }, danger: true });
      }

      items.forEach(function (item) {
        if (item.type === 'separator') {
          var sep = document.createElement('div');
          sep.className = 'context-menu-separator';
          menu.appendChild(sep);
          return;
        }
        var btn = document.createElement('button');
        btn.className = 'context-menu-item' + (item.danger ? ' danger' : '');
        btn.type = 'button';
        btn.innerHTML = '<i data-lucide="' + item.icon + '"></i><span>' + item.label + '</span>';
        btn.addEventListener('click', function () {
          ContextMenu.hide();
          item.action();
        });
        menu.appendChild(btn);
      });

      document.body.appendChild(menu);
      this._menu = menu;
      lucide.createIcons({ nodes: [menu] });

      // Keep menu within viewport
      requestAnimationFrame(function () {
        var rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
      });
    },

    /** Hide and remove the context menu. */
    hide() {
      if (this._menu && this._menu.parentNode) {
        this._menu.remove();
      }
      this._menu = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Drag & Drop
  // ---------------------------------------------------------------------------

  var DragDrop = {
    _dragCounter: 0,

    init() {
      var self = this;

      document.addEventListener('dragenter', function (e) {
        e.preventDefault();
        self._dragCounter++;
        var overlay = $('drag-overlay');
        if (overlay) overlay.hidden = false;
      });

      document.addEventListener('dragover', function (e) {
        e.preventDefault(); // Required for drop to work
      });

      document.addEventListener('dragleave', function (e) {
        e.preventDefault();
        self._dragCounter--;
        if (self._dragCounter <= 0) {
          self._dragCounter = 0;
          var overlay = $('drag-overlay');
          if (overlay) overlay.hidden = true;
        }
      });

      document.addEventListener('drop', function (e) {
        e.preventDefault();
        self._dragCounter = 0;
        var overlay = $('drag-overlay');
        if (overlay) overlay.hidden = true;

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          FileOps.upload(e.dataTransfer.files);
        }
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  var Search = {
    init() {
      var input = $('search-input');
      if (!input) return;

      var debouncedSearch = debounce(async function () {
        var query = input.value.trim();
        if (query.length === 0) {
          UI.isSearching = false;
          UI.renderBreadcrumb();
          UI.renderFileList();
          return;
        }
        UI.isSearching = true;
        UI.renderBreadcrumb();
        UI.renderFileList();
      }, 300);

      input.addEventListener('input', debouncedSearch);

      // Clear search on Escape while input is focused
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          input.value = '';
          UI.isSearching = false;
          UI.renderBreadcrumb();
          UI.renderFileList();
          input.blur();
        }
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    // -- Sidebar navigation --
    document.querySelectorAll('.nav-item[data-nav]').forEach(function (item) {
      item.addEventListener('click', function () {
        UI.setActiveSection(item.dataset.nav);
        // Clear search
        var searchInput = $('search-input');
        if (searchInput) searchInput.value = '';
      });
    });

    // -- Sidebar toggle (mobile) --
    var sidebarToggle = $('sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        var sidebar = $('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
      });
    }

    // -- Upload button --
    var uploadBtn = $('upload-btn');
    var fileInput = $('file-input');
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        if (fileInput.files.length > 0) {
          FileOps.upload(fileInput.files);
          fileInput.value = ''; // reset so same file can be re-uploaded
        }
      });
    }

    // -- New folder button --
    var newFolderBtn = $('new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', function () {
        var nameInput = $('folder-name-input');
        if (nameInput) nameInput.value = '';
        UI.openModal('folder-modal');
      });
    }

    // -- Create folder confirm --
    var createFolderBtn = $('create-folder-btn');
    if (createFolderBtn) {
      createFolderBtn.addEventListener('click', function () {
        var nameInput = $('folder-name-input');
        var name = nameInput ? nameInput.value : '';
        FileOps.createFolder(name, UI.currentFolder);
        UI.closeModal('folder-modal');
      });
    }

    // Enter key in folder name input
    var folderNameInput = $('folder-name-input');
    if (folderNameInput) {
      folderNameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (createFolderBtn) createFolderBtn.click();
        }
      });
    }

    // -- View toggle --
    $('grid-view-btn').addEventListener('click', function () { UI.toggleView('grid'); });
    $('list-view-btn').addEventListener('click', function () { UI.toggleView('list'); });

    // -- Sort dropdown --
    var sortBtn = $('sort-btn');
    var sortMenu = $('sort-menu');
    if (sortBtn && sortMenu) {
      sortBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        sortMenu.hidden = !sortMenu.hidden;
      });

      sortMenu.querySelectorAll('.dropdown-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var sortVal = item.dataset.sort; // e.g. "name-asc"
          var parts = sortVal.split('-');
          UI.sortBy = parts[0] === 'date' ? 'modified' : parts[0];
          UI.sortOrder = parts[1] || 'asc';

          // Update active state
          sortMenu.querySelectorAll('.dropdown-item').forEach(function (el) { el.classList.remove('active'); });
          item.classList.add('active');
          sortMenu.hidden = true;

          UI.renderFileList();
        });
      });
    }

    // -- Modal close buttons --
    document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        UI.closeModal(btn.dataset.modalClose);
      });
    });

    // -- Click on modal overlay to close --
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.hidden = true;
      });
    });

    // -- Viewer modal actions --
    var viewerBackBtn = $('viewer-back-btn');
    if (viewerBackBtn) {
      viewerBackBtn.addEventListener('click', function () { Viewer.close(); });
    }

    var viewerDownloadBtn = $('viewer-download-btn');
    if (viewerDownloadBtn) {
      viewerDownloadBtn.addEventListener('click', function () {
        if (Viewer.currentFile) FileOps.download(Viewer.currentFile.id);
      });
    }

    var viewerShareBtn = $('viewer-share-btn');
    if (viewerShareBtn) {
      viewerShareBtn.addEventListener('click', function () {
        if (Viewer.currentFile) FileOps.share(Viewer.currentFile.id);
      });
    }

    var viewerEditBtn = $('viewer-edit-btn');
    if (viewerEditBtn) {
      viewerEditBtn.addEventListener('click', function () {
        if (Viewer.currentFile) {
          Viewer.close();
          Editor.open(Viewer.currentFile.id);
        }
      });
    }

    var viewerDeleteBtn = $('viewer-delete-btn');
    if (viewerDeleteBtn) {
      viewerDeleteBtn.addEventListener('click', function () {
        if (Viewer.currentFile) {
          FileOps.delete(Viewer.currentFile.id);
          Viewer.close();
        }
      });
    }

    var viewerOpenWordBtn = $('viewer-open-word-btn');
    if (viewerOpenWordBtn) {
      viewerOpenWordBtn.addEventListener('click', function () {
        if (Viewer.currentFile) {
          // Try to open in Word using the ms-word protocol handler
          // This works when the file is served from a URL (GitHub Pages)
          var fileUrl = location.origin + location.pathname.replace(/\/[^/]*$/, '/') + 'demo-files/' + encodeURIComponent(Viewer.currentFile.name);
          window.open('ms-word:ofe|u|' + fileUrl, '_blank');
          UI.showToast('Opening in Microsoft Word...', 'info');
        }
      });
    }

    // -- Upload new version --
    var viewerUploadVersionBtn = $('viewer-upload-version-btn');
    var versionFileInput = $('version-file-input');
    if (viewerUploadVersionBtn && versionFileInput) {
      viewerUploadVersionBtn.addEventListener('click', function () {
        versionFileInput.click();
      });
      versionFileInput.addEventListener('change', async function () {
        if (versionFileInput.files.length > 0 && Viewer.currentFile) {
          var newFile = versionFileInput.files[0];
          try {
            var buffer = await newFile.arrayBuffer();
            await dataStore.setItem(Viewer.currentFile.id, buffer);
            await Storage.updateFile(Viewer.currentFile.id, {
              size: newFile.size,
              mimeType: newFile.type || Viewer.currentFile.mimeType,
              modifiedAt: Date.now()
            });
            UI.showToast('New version uploaded', 'success');
            // Refresh the viewer with updated file
            var updatedMeta = await Storage.getFile(Viewer.currentFile.id);
            if (updatedMeta) Viewer.open(updatedMeta);
            UI.renderFileList();
            UI.updateStorageBar();
          } catch (err) {
            console.error('Version upload failed:', err);
            UI.showToast('Upload failed', 'error');
          }
          versionFileInput.value = '';
        }
      });
    }

    // -- Viewer prev/next navigation --
    var viewerPrevBtn = $('viewer-prev-btn');
    var viewerNextBtn = $('viewer-next-btn');
    if (viewerPrevBtn) viewerPrevBtn.addEventListener('click', function () { Viewer.prev(); });
    if (viewerNextBtn) viewerNextBtn.addEventListener('click', function () { Viewer.next(); });

    // -- Click on viewer overlay background to close --
    var viewerBody = $('viewer-body');
    if (viewerBody) {
      viewerBody.addEventListener('click', function (e) {
        if (e.target === viewerBody) Viewer.close();
      });
    }

    // -- Share modal: copy link --
    var copyLinkBtn = $('copy-link-btn');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', function () {
        var fid = $('preview-panel').dataset.fileId;
        if (fid) FileOps.copyShareLink(fid);
      });
    }

    // -- Editor toolbar --
    var editorBoldBtn = $('editor-bold-btn');
    if (editorBoldBtn) editorBoldBtn.addEventListener('click', function () { Editor.applyFormat('bold'); });
    var editorItalicBtn = $('editor-italic-btn');
    if (editorItalicBtn) editorItalicBtn.addEventListener('click', function () { Editor.applyFormat('italic'); });
    var editorUnderlineBtn = $('editor-underline-btn');
    if (editorUnderlineBtn) editorUnderlineBtn.addEventListener('click', function () { Editor.applyFormat('underline'); });

    var editorSaveBtn = $('editor-save-btn');
    if (editorSaveBtn) editorSaveBtn.addEventListener('click', function () { Editor.save(); });
    var editorCloseBtn = $('editor-close-btn');
    if (editorCloseBtn) editorCloseBtn.addEventListener('click', function () { Editor.close(); });

    // -- Empty trash button (inject into toolbar dynamically) --
    var toolbarLeft = document.querySelector('.toolbar-left');
    if (toolbarLeft) {
      var emptyTrashBtn = document.createElement('button');
      emptyTrashBtn.className = 'btn btn-danger';
      emptyTrashBtn.id = 'empty-trash-btn';
      emptyTrashBtn.type = 'button';
      emptyTrashBtn.innerHTML = '<i data-lucide="trash-2"></i><span>Empty Trash</span>';
      emptyTrashBtn.hidden = true;
      emptyTrashBtn.addEventListener('click', function () {
        if (confirm('Permanently delete all files in trash?')) {
          FileOps.emptyTrash();
        }
      });
      toolbarLeft.appendChild(emptyTrashBtn);
    }

    // -- Theme toggle --
    var themeToggle = $('theme-toggle');
    var isDark = localStorage.getItem('opendocs-theme') === 'dark';
    if (isDark) document.body.classList.add('dark-theme');

    function syncDarkMode(enabled) {
      document.body.classList.toggle('dark-theme', enabled);
      localStorage.setItem('opendocs-theme', enabled ? 'dark' : 'light');
      var settingCheckbox = $('setting-dark-mode');
      if (settingCheckbox) settingCheckbox.checked = enabled;
    }

    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        syncDarkMode(!document.body.classList.contains('dark-theme'));
      });
    }

    // -- Settings --
    var settingsBtn = $('settings-btn');
    var settingsView = $('settings-view');
    var settingsBackBtn = $('settings-back-btn');
    var mainContent = $('main-content');
    var sidebar = $('sidebar');

    function openSettings() {
      if (mainContent) mainContent.hidden = true;
      if (sidebar) sidebar.hidden = true;
      if (settingsView) settingsView.hidden = false;
      lucide.createIcons({ nodes: [settingsView] });
    }

    function closeSettings() {
      if (settingsView) settingsView.hidden = true;
      if (mainContent) mainContent.hidden = false;
      if (sidebar) sidebar.hidden = false;
    }

    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    if (settingsBackBtn) settingsBackBtn.addEventListener('click', closeSettings);

    // -- Context menu: close on click outside --
    document.addEventListener('click', function () {
      ContextMenu.hide();
    });

    // -- Click on file browser background: deselect --
    var fileBrowser = $('file-browser');
    if (fileBrowser) {
      fileBrowser.addEventListener('click', function (e) {
        if (e.target === fileBrowser || e.target.id === 'empty-state') {
          UI.selectedFile = null;
          document.querySelectorAll('.file-card.selected, .file-row.selected').forEach(function (el) {
            el.classList.remove('selected');
          });
        }
      });
    }

    // -- Close sort dropdown when clicking outside --
    document.addEventListener('click', function () {
      if (sortMenu) sortMenu.hidden = true;
    });

    // -- Keyboard shortcuts --
    document.addEventListener('keydown', function (e) {
      var viewerOpen = $('viewer-modal') && !$('viewer-modal').hidden;

      // Escape: close viewer, modals, context menu
      if (e.key === 'Escape') {
        ContextMenu.hide();
        if (viewerOpen) { Viewer.close(); return; }

        var modals = document.querySelectorAll('.modal-overlay:not([hidden])');
        if (modals.length > 0) {
          modals.forEach(function (m) { m.hidden = true; });
          return;
        }
      }

      // Arrow keys: navigate files in viewer
      if (viewerOpen && e.key === 'ArrowLeft') { e.preventDefault(); Viewer.prev(); }
      if (viewerOpen && e.key === 'ArrowRight') { e.preventDefault(); Viewer.next(); }

      // Delete key: trash selected file (only if not typing in an input)
      if (e.key === 'Delete' && UI.selectedFile && !viewerOpen) {
        var tag = document.activeElement.tagName.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !document.activeElement.isContentEditable) {
          e.preventDefault();
          if (UI.currentSection === 'trash') {
            FileOps.permanentDelete(UI.selectedFile);
          } else {
            FileOps.delete(UI.selectedFile);
          }
        }
      }
    });

    // -- Initialize sub-modules --
    DragDrop.init();
    Search.init();

    // -- Check for share link in URL hash --
    handleShareHash();
    window.addEventListener('hashchange', handleShareHash);

    // -- Initialize lucide icons --
    lucide.createIcons();

    // -- Set initial view mode --
    UI.toggleView(UI.currentView);

    // -- Load initial file list --
    UI.renderBreadcrumb();
    UI.renderFileList();
    UI.updateStorageBar();
  }

  /**
   * Handle #shared/FILE_ID hash URLs.
   * Opens the preview for a shared file when the app loads with such a hash.
   */
  async function handleShareHash() {
    var hash = location.hash;
    if (hash.indexOf('#shared/') === 0) {
      var fileId = hash.replace('#shared/', '');
      try {
        var meta = await Storage.getFile(fileId);
        if (meta) {
          Viewer.open(meta);
        } else {
          UI.showToast('Shared file not found', 'error');
        }
      } catch (err) {
        UI.showToast('Failed to load shared file', 'error');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Demo Seed Data — German Construction Project
  // ---------------------------------------------------------------------------

  async function seedDemoData() {
    if (localStorage.getItem('opendocs-seeded')) return;
    localStorage.setItem('opendocs-seeded', '1');

    // Helper: create a folder and return its ID
    async function folder(name, parentId) {
      var id = crypto.randomUUID();
      await Storage.saveFile({
        id: id, name: name, type: 'folder', mimeType: null, size: 0,
        parentId: parentId || null, shared: false, sharedWith: [], starred: false, deleted: false
      }, null);
      return id;
    }

    // Helper: fetch a file from the repo and store it
    async function fetchFile(urlPath, name, parentId, opts) {
      opts = opts || {};
      try {
        var resp = await fetch(urlPath);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var buffer = await resp.arrayBuffer();
        var mimeTypes = {
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          pdf: 'application/pdf',
          svg: 'image/svg+xml',
          md: 'text/markdown',
          csv: 'text/csv',
          txt: 'text/plain'
        };
        var ext = (name.split('.').pop() || '').toLowerCase();
        await Storage.saveFile({
          id: crypto.randomUUID(), name: name, type: 'file',
          mimeType: mimeTypes[ext] || 'application/octet-stream',
          size: buffer.byteLength, parentId: parentId || null,
          shared: opts.shared || false,
          sharedWith: opts.sharedWith || [],
          starred: false, deleted: false
        }, buffer);
      } catch (err) {
        console.warn('Failed to fetch demo file: ' + urlPath, err);
      }
    }

    try {
      var base = 'demo-files/';

      // Root project folder
      var projekt = await folder('Projekt Neubau Bürogebäude München');

      // Subfolders
      var planung       = await folder('01 Planung', projekt);
      var genehmigungen = await folder('02 Genehmigungen', projekt);
      var ausfuehrung   = await folder('03 Bauausführung', projekt);
      var kosten        = await folder('04 Kostenplanung', projekt);
      var protokolle    = await folder('05 Protokolle', projekt);
      var fotos         = await folder('06 Fotos', projekt);
      var vertraege     = await folder('07 Verträge', projekt);
      var sicherheit    = await folder('08 Arbeitssicherheit', projekt);

      // Fetch all files from demo-files/
      await fetchFile(base + '01 Planung/Projektbeschreibung.docx', 'Projektbeschreibung.docx', planung);
      await fetchFile(base + '01 Planung/Raumprogramm.xlsx', 'Raumprogramm.xlsx', planung);
      await fetchFile(base + '01 Planung/Terminplan_Uebersicht.pdf', 'Terminplan_Übersicht.pdf', planung);
      await fetchFile(base + '01 Planung/Architekturbriefing.docx', 'Architekturbriefing.docx', planung);

      await fetchFile(base + '02 Genehmigungen/Baugenehmigung_Bescheid.pdf', 'Baugenehmigung_Bescheid.pdf', genehmigungen);
      await fetchFile(base + '02 Genehmigungen/Umweltvertraeglichkeitspruefung.docx', 'Umweltverträglichkeitsprüfung.docx', genehmigungen);
      await fetchFile(base + '02 Genehmigungen/Brandschutzkonzept_Entwurf.docx', 'Brandschutzkonzept_Entwurf.docx', genehmigungen);

      await fetchFile(base + '03 Bauausfuehrung/Baustellenordnung.pdf', 'Baustellenordnung.pdf', ausfuehrung);
      await fetchFile(base + '03 Bauausfuehrung/Nachunternehmer_Uebersicht.xlsx', 'Nachunternehmer_Übersicht.xlsx', ausfuehrung);
      await fetchFile(base + '03 Bauausfuehrung/Bautagesbericht_2026-03-15.docx', 'Bautagesbericht_2026-03-15.docx', ausfuehrung);
      await fetchFile(base + '03 Bauausfuehrung/Maengelliste.xlsx', 'Mängelliste.xlsx', ausfuehrung);

      await fetchFile(base + '04 Kostenplanung/Kostenschaetzung_DIN276.xlsx', 'Kostenschätzung_DIN276.xlsx', kosten);
      await fetchFile(base + '04 Kostenplanung/Zahlungsplan_2026.xlsx', 'Zahlungsplan_2026.xlsx', kosten);
      await fetchFile(base + '04 Kostenplanung/Nachtragsforderungen.docx', 'Nachtragsforderungen.docx', kosten);

      await fetchFile(base + '05 Protokolle/Baubesprechung_Nr12_2026-04-02.docx', 'Baubesprechung_Nr12_2026-04-02.docx', protokolle,
        { shared: true, sharedWith: [
          { name: 'Thomas Berger', email: 'berger@bau-mg.de', permission: 'edit' },
          { name: 'Martin Müller', email: 'mueller@ms-immo.de', permission: 'view' }
        ]});
      await fetchFile(base + '05 Protokolle/Baubesprechung_Nr11_2026-03-26.docx', 'Baubesprechung_Nr11_2026-03-26.docx', protokolle);
      await fetchFile(base + '05 Protokolle/Abnahmeprotokoll_Vorlage.docx', 'Abnahmeprotokoll_Vorlage.docx', protokolle);

      await fetchFile(base + '06 Fotos/Baustellenuebersicht_2026-03-10.jpg', 'Baustellenübersicht_2026-03-10.jpg', fotos);
      await fetchFile(base + '06 Fotos/Baugrube_von_oben_2026-04-01.jpg', 'Baugrube_von_oben_2026-04-01.jpg', fotos);
      await fetchFile(base + '06 Fotos/Baustellenzufahrt_2026-03-05.jpg', 'Baustellenzufahrt_2026-03-05.jpg', fotos);
      await fetchFile(base + '06 Fotos/Rohbauarbeiten_2026-03-25.jpg', 'Rohbauarbeiten_2026-03-25.jpg', fotos);

      await fetchFile(base + '07 Vertraege/Generalplanervertrag_Entwurf.docx', 'Generalplanervertrag_Entwurf.docx', vertraege);
      await fetchFile(base + '07 Vertraege/Buergschaftsuebersicht.xlsx', 'Bürgschaftsübersicht.xlsx', vertraege);

      await fetchFile(base + '08 Arbeitssicherheit/SiGePlan_Uebersicht.docx', 'SiGePlan_Übersicht.docx', sicherheit);
      await fetchFile(base + '08 Arbeitssicherheit/Unterweisungsnachweis_2026-03.xlsx', 'Unterweisungsnachweis_2026-03.xlsx', sicherheit);
      await fetchFile(base + '08 Arbeitssicherheit/Unfallbericht_Vorlage.docx', 'Unfallbericht_Vorlage.docx', sicherheit);

      // Root-level files
      await fetchFile(base + 'Projektuebersicht.md', 'Projektübersicht.md', projekt,
        { shared: true, sharedWith: [
          { name: 'Sabine Lechner', email: 'lechner@arch-lk.de', permission: 'edit' },
          { name: 'Thomas Berger', email: 'berger@bau-mg.de', permission: 'edit' },
          { name: 'Andrea Hofmann', email: 'hofmann@sigeko.de', permission: 'view' }
        ]});
      await fetchFile(base + 'Kontaktliste.xlsx', 'Kontaktliste.xlsx', projekt);

      UI.showToast('Demo-Projekt geladen: Neubau Bürogebäude München', 'success');
    } catch (err) {
      console.error('Seed failed:', err);
      UI.showToast('Demo-Daten konnten nicht geladen werden', 'error');
    }
  }

  // -- Boot the application --
  document.addEventListener('DOMContentLoaded', async function () {
    init();
    await seedDemoData();
    // Re-render after seeding
    if (localStorage.getItem('opendocs-seeded')) {
      UI.renderFileList();
      UI.updateStorageBar();
    }
  });

})();
