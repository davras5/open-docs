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
    async renderFileList() {
      var browser = $('file-browser');
      var emptyState = $('empty-state');
      if (!browser) return;

      // Remove previous file items (keep the empty state element)
      var existing = browser.querySelectorAll('.file-card, .file-row, .file-list-table');
      existing.forEach(function (el) { el.remove(); });

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
      // Single click — folders navigate in, files select
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        if (file.type === 'folder') {
          self.currentFolder = file.id;
          self.isSearching = false;
          self.renderBreadcrumb();
          self.renderFileList();
        } else {
          self.selectFile(file.id);
        }
      });
      // Double click — open preview for files
      el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        if (file.type !== 'folder') {
          Preview.show(file);
        }
      });
      // Right click — context menu
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
          items.push({ label: 'Open / Preview', icon: 'eye', action: function () { Preview.show(file); } });
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

    // -- Preview panel actions --
    var previewCloseBtn = $('preview-close-btn');
    if (previewCloseBtn) {
      previewCloseBtn.addEventListener('click', function () { UI.hidePreview(); });
    }

    var previewDownloadBtn = $('preview-download-btn');
    if (previewDownloadBtn) {
      previewDownloadBtn.addEventListener('click', function () {
        var fid = $('preview-panel').dataset.fileId;
        if (fid) FileOps.download(fid);
      });
    }

    var previewShareBtn = $('preview-share-btn');
    if (previewShareBtn) {
      previewShareBtn.addEventListener('click', function () {
        var fid = $('preview-panel').dataset.fileId;
        if (fid) FileOps.share(fid);
      });
    }

    var previewEditBtn = $('preview-edit-btn');
    if (previewEditBtn) {
      previewEditBtn.addEventListener('click', function () {
        var fid = $('preview-panel').dataset.fileId;
        if (fid) Editor.open(fid);
      });
    }

    var previewDeleteBtn = $('preview-delete-btn');
    if (previewDeleteBtn) {
      previewDeleteBtn.addEventListener('click', function () {
        var fid = $('preview-panel').dataset.fileId;
        if (fid) FileOps.delete(fid);
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
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('opendocs-theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
      });
      // Restore theme
      if (localStorage.getItem('opendocs-theme') === 'dark') {
        document.body.classList.add('dark-theme');
      }
    }

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
      // Escape: close modals/preview/context menu
      if (e.key === 'Escape') {
        ContextMenu.hide();

        // Close any open modal
        var modals = document.querySelectorAll('.modal-overlay:not([hidden])');
        if (modals.length > 0) {
          modals.forEach(function (m) { m.hidden = true; });
          return;
        }

        // Close preview
        UI.hidePreview();
      }

      // Delete key: trash selected file (only if not typing in an input)
      if (e.key === 'Delete' && UI.selectedFile) {
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
          Preview.show(meta);
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
    // Only seed once
    if (localStorage.getItem('opendocs-seeded')) return;

    var enc = new TextEncoder();

    // Helper: create a folder and return its ID
    async function folder(name, parentId) {
      var id = crypto.randomUUID();
      await Storage.saveFile({
        id: id, name: name, type: 'folder', mimeType: null, size: 0,
        parentId: parentId || null, shared: false, sharedWith: [], starred: false, deleted: false
      }, null);
      return id;
    }

    // Helper: create a file
    async function file(name, mimeType, content, parentId, opts) {
      opts = opts || {};
      var buf = (content instanceof ArrayBuffer) ? content : enc.encode(content).buffer;
      await Storage.saveFile({
        id: crypto.randomUUID(), name: name, type: 'file', mimeType: mimeType,
        size: buf.byteLength, parentId: parentId || null,
        shared: opts.shared || false,
        sharedWith: opts.sharedWith || [],
        starred: opts.starred || false,
        deleted: false
      }, buf);
    }

    // Create a minimal valid PNG (1x1 blue pixel)
    function makeTinyPNG(r, g, b) {
      var base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8' +
        (r === 0 ? 'H8BfwzAEA' : 'b5hfDwMDAQA') + 'I/AF8AAAAABJRU5ErkJggg==';
      var binary = atob(base64);
      var arr = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      return arr.buffer;
    }

    // Create a minimal SVG as an "image"
    function makeSVG(label, color) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
        '<rect width="800" height="600" fill="' + color + '"/>' +
        '<text x="400" y="300" font-family="Arial" font-size="32" fill="white" text-anchor="middle" dominant-baseline="middle">' + label + '</text>' +
        '</svg>';
    }

    try {
      // ── Root Project Folder ──
      var projekt = await folder('Projekt Neubau Bürogebäude München');

      // ── Subfolders ──
      var planung       = await folder('01 Planung', projekt);
      var genehmigungen = await folder('02 Genehmigungen', projekt);
      var ausfuehrung   = await folder('03 Bauausführung', projekt);
      var kosten        = await folder('04 Kostenplanung', projekt);
      var protokolle    = await folder('05 Protokolle', projekt);
      var fotos         = await folder('06 Fotos', projekt);
      var vertraege     = await folder('07 Verträge', projekt);
      var sicherheit    = await folder('08 Arbeitssicherheit', projekt);

      // ── 01 Planung ──
      await file('Projektbeschreibung.txt', 'text/plain',
        'PROJEKTBESCHREIBUNG\n' +
        '====================\n\n' +
        'Projekt:        Neubau Bürogebäude „TechPark München Ost"\n' +
        'Bauherr:        Müller & Schmidt Immobilien GmbH\n' +
        'Standort:       Messestraße 42, 81829 München\n' +
        'Grundstück:     4.200 m²\n' +
        'Bruttogeschossfläche: 12.500 m²\n' +
        'Geschosse:      6 OG + 2 UG (Tiefgarage)\n' +
        'Stellplätze:    180 (Tiefgarage) + 40 (oberirdisch)\n\n' +
        'Geplante Nutzung:\n' +
        '- EG: Empfang, Konferenzräume, Cafeteria\n' +
        '- 1.-5. OG: Büroflächen (Open Space + Einzelbüros)\n' +
        '- 6. OG: Geschäftsführung, Dachterrasse\n' +
        '- UG1: Tiefgarage, Technikräume\n' +
        '- UG2: Tiefgarage, Lagerräume\n\n' +
        'Bauweise:       Stahlbetonkonstruktion mit vorgehängter Glasfassade\n' +
        'Energiestandard: KfW-Effizienzgebäude 40\n' +
        'Zertifizierung: DGNB Gold angestrebt\n\n' +
        'Zeitraum:       03/2026 – 09/2028\n' +
        'Gesamtbudget:   ca. 38,5 Mio. EUR (brutto)\n',
        planung);

      await file('Raumprogramm.csv', 'text/csv',
        'Geschoss;Bereich;Fläche (m²);Anzahl Arbeitsplätze;Bemerkung\n' +
        'EG;Empfang / Lobby;280;;Repräsentativ gestaltet\n' +
        'EG;Konferenzräume;420;60;6 Räume verschiedener Größe\n' +
        'EG;Cafeteria / Küche;180;;Inkl. Außenbestuhlung\n' +
        'EG;Technik / Sanitär;120;;\n' +
        '1. OG;Open Space Büro;1.450;120;Flexible Arbeitsplätze\n' +
        '1. OG;Besprechungszimmer;180;24;4 Räume\n' +
        '1. OG;Teeküche / Sozialraum;80;;\n' +
        '2. OG;Open Space Büro;1.450;120;\n' +
        '2. OG;Besprechungszimmer;180;24;\n' +
        '2. OG;Teeküche / Sozialraum;80;;\n' +
        '3. OG;Einzelbüros;900;45;18 Büros\n' +
        '3. OG;Open Space;550;48;\n' +
        '3. OG;Besprechungszimmer;120;16;\n' +
        '4. OG;Einzelbüros;900;45;\n' +
        '4. OG;Open Space;550;48;\n' +
        '4. OG;Serverraum;60;;Klimatisiert\n' +
        '5. OG;Einzelbüros;680;34;\n' +
        '5. OG;Großraumbüro;620;52;\n' +
        '5. OG;Schulungsraum;200;30;\n' +
        '6. OG;Geschäftsführung;450;8;Inkl. Sekretariat\n' +
        '6. OG;Vorstandszimmer;120;12;\n' +
        '6. OG;Dachterrasse;280;;Begrünt\n' +
        'UG1;Tiefgarage;2.800;100;Stellplätze\n' +
        'UG1;Technikräume;400;;HLKS\n' +
        'UG2;Tiefgarage;2.400;80;Stellplätze\n' +
        'UG2;Lagerräume;300;;\n',
        planung);

      await file('Terminplan_Übersicht.md', 'text/markdown',
        '# Terminplan — Neubau Bürogebäude München\n\n' +
        '## Meilensteine\n\n' +
        '| Nr. | Meilenstein | Termin | Status |\n' +
        '|-----|-------------|--------|--------|\n' +
        '| M1  | Baugenehmigung erteilt | 15.02.2026 | ✅ Erledigt |\n' +
        '| M2  | Baustelleneinrichtung | 01.03.2026 | ✅ Erledigt |\n' +
        '| M3  | Aushub & Verbau fertig | 30.04.2026 | 🔄 Laufend |\n' +
        '| M4  | Rohbau UG fertig | 31.07.2026 | ⏳ Offen |\n' +
        '| M5  | Rohbau gesamt fertig | 28.02.2027 | ⏳ Offen |\n' +
        '| M6  | Fassade geschlossen | 30.06.2027 | ⏳ Offen |\n' +
        '| M7  | Innenausbau fertig | 31.03.2028 | ⏳ Offen |\n' +
        '| M8  | TGA Abnahme | 30.06.2028 | ⏳ Offen |\n' +
        '| M9  | Gesamtabnahme | 31.08.2028 | ⏳ Offen |\n' +
        '| M10 | Übergabe an Bauherr | 15.09.2028 | ⏳ Offen |\n\n' +
        '## Kritischer Pfad\n\n' +
        '- Gründungsarbeiten müssen vor Frostperiode abgeschlossen sein\n' +
        '- Fassadenmontage wetterabhängig (April–Oktober empfohlen)\n' +
        '- TGA-Installation parallel zum Innenausbau ab 3. OG\n\n' +
        '## Hinweise\n\n' +
        '- Pufferzeit: 4 Wochen vor jedem Meilenstein eingeplant\n' +
        '- Wöchentliche Fortschrittsbesprechung: Dienstag 10:00 Uhr\n',
        planung);

      await file('Architekturbriefing.txt', 'text/plain',
        'ARCHITEKTURBRIEFING — TechPark München Ost\n' +
        '============================================\n\n' +
        'Gestaltungskonzept:\n' +
        '- Moderne, offene Architektur mit maximaler Tageslichtnutzung\n' +
        '- Glas-Aluminium-Fassade mit Sonnenschutzverglasung\n' +
        '- Begrüntes Atrium im Erdgeschoss\n' +
        '- Dachterrasse mit extensiver Begrünung\n\n' +
        'Materialien:\n' +
        '- Fassade: Structural-Glazing, Aluminium-Profile (eloxiert, anthrazit)\n' +
        '- Innen: Eichenparkett, Sichtbeton-Akzente, Akustikdecken\n' +
        '- Außenbereich: Naturstein (Granit), Cortenstahl-Elemente\n\n' +
        'Nachhaltigkeitsanforderungen:\n' +
        '- Photovoltaik-Anlage auf Dachfläche (min. 120 kWp)\n' +
        '- Geothermie-Nutzung für Heizung und Kühlung\n' +
        '- Regenwassernutzung für Bewässerung und WC-Spülung\n' +
        '- Ladeinfrastruktur für E-Fahrzeuge (30% der Stellplätze)\n',
        planung);

      // ── 02 Genehmigungen ──
      await file('Baugenehmigung_Bescheid.txt', 'text/plain',
        'LANDESHAUPTSTADT MÜNCHEN\n' +
        'Referat für Stadtplanung und Bauordnung\n' +
        'Lokalbaukommission\n\n' +
        '══════════════════════════════════════════\n' +
        '           BAUGENEHMIGUNGSBESCHEID\n' +
        '══════════════════════════════════════════\n\n' +
        'Aktenzeichen:    LBK-2025-48291-BG\n' +
        'Datum:           15.02.2026\n\n' +
        'Bauherr:         Müller & Schmidt Immobilien GmbH\n' +
        '                 Leopoldstraße 120, 80802 München\n\n' +
        'Baugrundstück:   Messestraße 42, Fl.-Nr. 1847/3\n' +
        '                 Gemarkung Berg am Laim\n\n' +
        'Bauvorhaben:     Neubau eines sechsgeschossigen Bürogebäudes\n' +
        '                 mit zweigeschossiger Tiefgarage\n\n' +
        'Hiermit wird die Baugenehmigung gemäß Art. 68 BayBO erteilt.\n\n' +
        'Auflagen:\n' +
        '1. Die Bauarbeiten sind auf Mo–Fr 07:00–20:00 und Sa 08:00–14:00 zu beschränken.\n' +
        '2. Ein Erschütterungsgutachten ist vor Beginn der Rammarbeiten vorzulegen.\n' +
        '3. Der Baumbestand gemäß Baumschutzverordnung ist zu erhalten.\n' +
        '4. Stellplatznachweis: 180 Stellplätze in der Tiefgarage nachgewiesen.\n' +
        '5. Brandschutznachweis ist durch einen Prüfsachverständigen zu bestätigen.\n\n' +
        'Diese Genehmigung erlischt, wenn nicht innerhalb von 3 Jahren mit dem\n' +
        'Bau begonnen wird.\n\n' +
        'Rechtsbehelfsbelehrung:\n' +
        'Gegen diesen Bescheid kann innerhalb eines Monats Klage erhoben werden.\n',
        genehmigungen);

      await file('Umweltverträglichkeitsprüfung.txt', 'text/plain',
        'UMWELTVERTRÄGLICHKEITSPRÜFUNG — Zusammenfassung\n' +
        '=================================================\n\n' +
        'Gutachter: Ing.-Büro Grüne Zukunft GmbH, München\n' +
        'Datum: 08.11.2025\n\n' +
        'Schutzgut Boden:\n' +
        '- Versiegelungsgrad steigt von 45% auf 72%\n' +
        '- Ausgleich durch Dachbegrünung und Entsiegelung angrenzender Flächen\n' +
        '- Altlastenverdacht: keine Belastungen nachgewiesen\n\n' +
        'Schutzgut Wasser:\n' +
        '- Grundwasserstand: ca. 3,8 m unter GOK\n' +
        '- Wasserhaltung während Bauphase erforderlich\n' +
        '- Versickerung von Oberflächenwasser über Rigolen\n\n' +
        'Schutzgut Luft / Klima:\n' +
        '- Keine erheblichen Beeinträchtigungen zu erwarten\n' +
        '- Kaltluftschneise bleibt durch Gebäudestellung erhalten\n\n' +
        'Schutzgut Flora / Fauna:\n' +
        '- 3 Laubbäume müssen gefällt werden (Ausgleichspflanzung: 6 Bäume)\n' +
        '- Keine geschützten Arten auf dem Grundstück nachgewiesen\n\n' +
        'Ergebnis: Das Vorhaben ist umweltverträglich.\n',
        genehmigungen);

      await file('Brandschutzkonzept_Entwurf.txt', 'text/plain',
        'BRANDSCHUTZKONZEPT (Entwurf)\n' +
        '============================\n\n' +
        'Erstellt: Brandschutz Ingenieure Weber & Partner\n' +
        'Stand: 20.01.2026\n\n' +
        'Gebäudeklasse: 5 (Hochhausgrenze nicht überschritten)\n' +
        'Nutzung: Büro (Sonderbau gemäß Art. 2 Abs. 4 BayBO)\n\n' +
        'Rettungswege:\n' +
        '- 2 bauliche Rettungswege je Geschoss (notwendige Treppenhäuser)\n' +
        '- Treppenhaus Nord: 1,50 m Laufbreite\n' +
        '- Treppenhaus Süd: 1,50 m Laufbreite\n' +
        '- Rettungsweglänge max. 35 m (nachgewiesen)\n\n' +
        'Brandabschnitte:\n' +
        '- Jedes Geschoss bildet einen Brandabschnitt\n' +
        '- Tiefgarage: eigener Brandabschnitt mit F90-Abtrennung\n' +
        '- Technikräume: F90-Abtrennung\n\n' +
        'Löschanlagen:\n' +
        '- Sprinkleranlage gemäß VdS CEA 4001 (Vollschutz)\n' +
        '- Wandhydranten in allen Geschossen\n' +
        '- Tiefgarage: Sprinkler + CO2-Löschanlage (E-Fahrzeuge)\n\n' +
        'Rauchableitung:\n' +
        '- Natürliche Entrauchung über Fassadenöffnungen\n' +
        '- Maschinelle Entrauchung in Tiefgarage und Atrium\n' +
        '- Rauch- und Wärmeabzugsanlage (RWA) im Treppenhaus\n\n' +
        'Brandmeldeanlage: Kategorie 1 (Vollschutz), BMA mit Aufschaltung zur Feuerwehr\n',
        genehmigungen);

      // ── 03 Bauausführung ──
      await file('Baustellenordnung.txt', 'text/plain',
        'BAUSTELLENORDNUNG\n' +
        'Projekt: Neubau Bürogebäude TechPark München Ost\n' +
        '================================================\n\n' +
        'Gültig ab: 01.03.2026\n' +
        'Bauleitung: Dipl.-Ing. Thomas Berger, Berger Baumanagement GmbH\n\n' +
        '1. ARBEITSZEITEN\n' +
        '   Mo–Fr: 07:00–18:00 Uhr\n' +
        '   Sa:    08:00–14:00 Uhr (nach Voranmeldung)\n' +
        '   Sonn- und Feiertage: Arbeitsverbot\n\n' +
        '2. ZUGANG\n' +
        '   - Zufahrt ausschließlich über Messestraße (Tor 1)\n' +
        '   - Alle Personen müssen sich am Baucontainer anmelden\n' +
        '   - Persönliche Schutzausrüstung ist Pflicht: Helm, Sicherheitsschuhe, Warnweste\n' +
        '   - Unbefugten ist der Zutritt verboten\n\n' +
        '3. ORDNUNG UND SAUBERKEIT\n' +
        '   - Jedes Gewerk räumt seinen Arbeitsbereich täglich auf\n' +
        '   - Mülltrennung ist vorgeschrieben (Container: Bauschutt, Holz, Metall, Restmüll)\n' +
        '   - Gefahrstoffe sind im Gefahrstofflager zu lagern\n\n' +
        '4. SICHERHEIT\n' +
        '   - Sicherheitsunterweisung vor Arbeitsbeginn verpflichtend\n' +
        '   - Absturzsicherung ab 2 m Höhe\n' +
        '   - Feuerlöscher an jedem Geschoss vorhalten\n' +
        '   - Sammelplatz bei Evakuierung: Parkplatz Messestraße 38\n\n' +
        '5. ANSPRECHPARTNER\n' +
        '   Bauleiter:         Dipl.-Ing. Thomas Berger     | 0171 555 2341\n' +
        '   SiGeKo:            Ing. Andrea Hofmann           | 0172 888 4567\n' +
        '   Polier:            Michael Gruber                | 0170 333 9876\n',
        ausfuehrung);

      await file('Nachunternehmer_Übersicht.csv', 'text/csv',
        'Gewerk;Firma;Ansprechpartner;Vertragssumme (EUR);Status;Beginn;Ende\n' +
        'Erdarbeiten / Verbau;Bauer Tiefbau GmbH;Hr. Bauer;1.850.000;Beauftragt;01.03.2026;30.04.2026\n' +
        'Rohbau;Züblin AG, NL München;Fr. Kellner;8.200.000;Beauftragt;01.05.2026;28.02.2027\n' +
        'Fassade;Metallbau Schüco Partner;Hr. Weiss;4.100.000;Vergabe läuft;01.03.2027;30.06.2027\n' +
        'Elektro;Elektro Müller GmbH;Hr. Müller;2.300.000;Beauftragt;01.06.2027;31.01.2028\n' +
        'Heizung / Lüftung / Sanitär;Haustechnik Süd GmbH;Fr. Wagner;3.500.000;Beauftragt;01.06.2027;28.02.2028\n' +
        'Aufzüge;Schindler Deutschland;Hr. Fischer;680.000;Angebot liegt vor;01.09.2027;31.01.2028\n' +
        'Trockenbau;Knauf Systeme Partner;Hr. Braun;1.200.000;Vergabe läuft;01.09.2027;31.03.2028\n' +
        'Bodenbeläge;Parkett & Design GmbH;Fr. Schwarz;890.000;Noch nicht vergeben;01.01.2028;30.04.2028\n' +
        'Malerarbeiten;Malerbetrieb König;Hr. König;520.000;Noch nicht vergeben;01.02.2028;30.04.2028\n' +
        'Außenanlagen;Garten- und Landschaftsbau Grün;Hr. Stein;740.000;Noch nicht vergeben;01.05.2028;31.07.2028\n' +
        'Sprinkler / BMA;Minimax GmbH;Fr. Richter;960.000;Angebot liegt vor;01.07.2027;31.12.2027\n',
        ausfuehrung);

      await file('Bautagesbericht_2026-03-15.txt', 'text/plain',
        'BAUTAGESBERICHT\n' +
        '===============\n\n' +
        'Projekt:  Neubau Bürogebäude TechPark München Ost\n' +
        'Datum:    15.03.2026 (Dienstag)\n' +
        'Wetter:   Bewölkt, 8°C, kein Niederschlag\n' +
        'Bericht:  Dipl.-Ing. Thomas Berger\n\n' +
        'PERSONAL AUF DER BAUSTELLE:\n' +
        '- Bauer Tiefbau:    12 Arbeiter, 1 Polier\n' +
        '- Vermessung:       2 Vermessungsingenieure\n' +
        '- Bauleitung:       1 Bauleiter, 1 Bauüberwacher\n\n' +
        'GERÄTE:\n' +
        '- 1x Raupenbagger CAT 330 (Aushub)\n' +
        '- 2x LKW Kipper (Erdtransport)\n' +
        '- 1x Radlader Liebherr L 550\n' +
        '- 1x Rüttelplatte (Verdichtung)\n\n' +
        'DURCHGEFÜHRTE ARBEITEN:\n' +
        '- Aushub Baugrube Abschnitt B2, Tiefe -3,20 m erreicht\n' +
        '- Verbauarbeiten (Spundwand) Achse 3–5 fortgesetzt\n' +
        '- Grundwassermessung: Pegel bei -3,65 m (unverändert)\n' +
        '- Erdtransport: ca. 280 m³ abgefahren (Deponie Feldmoching)\n\n' +
        'BESONDERE VORKOMMNISSE:\n' +
        '- Keine\n\n' +
        'NÄCHSTE SCHRITTE:\n' +
        '- Aushub Abschnitt B3 beginnen\n' +
        '- Spundwandarbeiten Achse 5–7\n' +
        '- Baugrubensohle Abschnitt B1 verdichten\n',
        ausfuehrung);

      await file('Mängelliste.csv', 'text/csv',
        'Nr.;Gewerk;Beschreibung;Ort;Festgestellt am;Frist;Status;Verantwortlich\n' +
        'M-001;Erdarbeiten;Verdichtungsgrad in Achse 2 nicht erreicht (95% statt 97%);UG2, Abschnitt A1;12.04.2026;19.04.2026;Offen;Bauer Tiefbau\n' +
        'M-002;Verbau;Spundwand Achse 4 weist Versatz von 3 cm auf;Nordseite;08.04.2026;15.04.2026;In Bearbeitung;Bauer Tiefbau\n' +
        'M-003;Rohbau;Betondeckung an Stütze C3 unterschritten;1. OG;15.06.2026;22.06.2026;Behoben;Züblin AG\n',
        ausfuehrung);

      // ── 04 Kostenplanung ──
      await file('Kostenschätzung_DIN276.csv', 'text/csv',
        'KG;Kostengruppe;Bezeichnung;Kosten (EUR netto);Kosten (EUR brutto);Anteil (%)\n' +
        '100;Grundstück;Grundstückskosten;5.200.000;6.188.000;16,1\n' +
        '200;Vorbereitende Maßnahmen;Herrichten, Erschließen;380.000;452.200;1,2\n' +
        '300;Bauwerk – Baukonstruktionen;Rohbau, Fassade, Ausbau;16.800.000;19.992.000;51,9\n' +
        '310;;Baugrube;1.850.000;2.201.500;\n' +
        '320;;Gründung;1.200.000;1.428.000;\n' +
        '330;;Außenwände / Fassade;4.100.000;4.879.000;\n' +
        '340;;Innenwände;1.200.000;1.428.000;\n' +
        '350;;Decken;3.800.000;4.522.000;\n' +
        '360;;Dächer;950.000;1.130.500;\n' +
        '370;;Baukonstruktive Einbauten;680.000;809.200;\n' +
        '390;;Sonstige;3.020.000;3.593.800;\n' +
        '400;Bauwerk – Technische Anlagen;HLKS, Elektro, Aufzüge;7.440.000;8.853.600;23,0\n' +
        '410;;Abwasser, Wasser, Gas;620.000;737.800;\n' +
        '420;;Wärmeversorgung;1.100.000;1.309.000;\n' +
        '430;;Lüftung / Klima;1.450.000;1.725.500;\n' +
        '440;;Starkstromanlagen;1.500.000;1.785.000;\n' +
        '450;;Fernmelde / IT;800.000;952.000;\n' +
        '460;;Aufzüge;680.000;809.200;\n' +
        '470;;Sprinkler / BMA;960.000;1.142.400;\n' +
        '490;;Sonstige TGA;330.000;392.700;\n' +
        '500;Außenanlagen;Außenanlagen, Stellplätze;740.000;880.600;2,3\n' +
        '600;Ausstattung / Kunstwerke;;120.000;142.800;0,4\n' +
        '700;Baunebenkosten;Planung, Gutachten, Gebühren;1.650.000;1.963.500;5,1\n' +
        ';;;GESAMT;32.330.000;38.472.700;100,0\n',
        kosten);

      await file('Zahlungsplan_2026.csv', 'text/csv',
        'Monat;Geplant (EUR);Kumuliert (EUR);Ist (EUR);Abweichung (EUR);Bemerkung\n' +
        'März 2026;680.000;680.000;695.200;+15.200;Baustelleneinrichtung teurer\n' +
        'April 2026;920.000;1.600.000;880.000;-40.000;\n' +
        'Mai 2026;1.100.000;2.700.000;;;Prognose\n' +
        'Juni 2026;1.350.000;4.050.000;;;Prognose\n' +
        'Juli 2026;1.350.000;5.400.000;;;Prognose\n' +
        'August 2026;1.200.000;6.600.000;;;Prognose\n' +
        'September 2026;1.400.000;8.000.000;;;Prognose\n' +
        'Oktober 2026;1.500.000;9.500.000;;;Prognose\n' +
        'November 2026;1.300.000;10.800.000;;;Prognose\n' +
        'Dezember 2026;800.000;11.600.000;;;Winterpause, reduziert\n',
        kosten);

      await file('Nachtragsforderungen.md', 'text/markdown',
        '# Nachtragsforderungen — Stand April 2026\n\n' +
        '## NT-001: Mehrkosten Verbauarbeiten\n\n' +
        '- **Auftragnehmer:** Bauer Tiefbau GmbH\n' +
        '- **Forderung:** 85.000 EUR netto\n' +
        '- **Begründung:** Unerwartete Findlinge im Baugrund, zusätzlicher Aushub und\n' +
        '  Felsfräsarbeiten erforderlich. Bodengutachten hatte sandigen Kies prognostiziert.\n' +
        '- **Bewertung Bauleitung:** Teilweise berechtigt. Empfehlung: 62.000 EUR anerkennen.\n' +
        '- **Status:** In Prüfung\n\n' +
        '## NT-002: Mehrkosten Wasserhaltung\n\n' +
        '- **Auftragnehmer:** Bauer Tiefbau GmbH\n' +
        '- **Forderung:** 38.000 EUR netto\n' +
        '- **Begründung:** Grundwasserzustrom höher als im Gutachten angenommen.\n' +
        '  Zusätzliche Pumpen und längere Laufzeit erforderlich.\n' +
        '- **Bewertung Bauleitung:** Berechtigt, Mengenmehrung nachvollziehbar.\n' +
        '- **Status:** Genehmigt durch Bauherrn (18.04.2026)\n\n' +
        '---\n\n' +
        '**Summe Nachtragsforderungen:** 123.000 EUR netto\n' +
        '**Davon anerkannt:** 38.000 EUR netto\n' +
        '**Davon in Prüfung:** 85.000 EUR netto\n',
        kosten);

      // ── 05 Protokolle ──
      await file('Baubesprechung_Nr12_2026-04-02.md', 'text/markdown',
        '# Baubesprechung Nr. 12\n\n' +
        '**Datum:** 02.04.2026, 10:00–11:30 Uhr\n' +
        '**Ort:** Baubüro Container, Messestraße 42\n\n' +
        '**Teilnehmer:**\n' +
        '- Dipl.-Ing. Thomas Berger (Bauleitung)\n' +
        '- Dr. Martin Müller (Bauherr)\n' +
        '- Arch. Sabine Lechner (Entwurf)\n' +
        '- Ing. Andrea Hofmann (SiGeKo)\n' +
        '- Hr. Josef Bauer (Bauer Tiefbau)\n' +
        '- Fr. Claudia Kellner (Züblin AG)\n\n' +
        '---\n\n' +
        '## TOP 1: Terminübersicht\n\n' +
        'Der Aushub liegt ca. 5 Arbeitstage hinter dem Plan. Ursache:\n' +
        'Findlinge im Bereich Achse 2-4 (siehe Nachtrag NT-001).\n' +
        'Maßnahme: Zusätzlicher Bagger ab KW 15 auf der Baustelle.\n\n' +
        '**Verantwortlich:** Hr. Bauer | **Termin:** 07.04.2026\n\n' +
        '## TOP 2: Rohbauplanung\n\n' +
        'Züblin bestätigt die Bereitschaft zur Mobilisierung ab 01.05.2026.\n' +
        'Schalungspläne für UG2 werden bis 15.04.2026 eingereicht.\n' +
        'Bewehrungspläne vom Tragwerksplaner stehen noch aus.\n\n' +
        '**Verantwortlich:** Fr. Kellner / Tragwerksplaner | **Termin:** 15.04.2026\n\n' +
        '## TOP 3: Kosten\n\n' +
        'Nachtrag NT-001 wird geprüft. Nachtrag NT-002 (Wasserhaltung)\n' +
        'wurde vom Bauherrn in der Besprechung genehmigt.\n\n' +
        'Aktueller Budgetstatus: im Plan (Abweichung < 1%)\n\n' +
        '## TOP 4: Arbeitssicherheit\n\n' +
        'Fr. Hofmann meldet: Baustellenbegehung am 28.03. ohne Beanstandungen.\n' +
        'PSA-Kontrolle ab nächster Woche verschärft (Helmtragepflicht in allen Bereichen).\n\n' +
        '## TOP 5: Verschiedenes\n\n' +
        '- Bauherr wünscht Foto-Dokumentation alle 2 Wochen\n' +
        '- Nächste Baubesprechung: 09.04.2026, 10:00 Uhr\n\n' +
        '---\n\n' +
        '*Protokoll erstellt: Th. Berger, 02.04.2026*\n',
        protokolle, { shared: true, sharedWith: [
          { name: 'Thomas Berger', email: 'berger@bau-mg.de', permission: 'edit' },
          { name: 'Martin Müller', email: 'mueller@ms-immo.de', permission: 'view' }
        ]});

      await file('Baubesprechung_Nr11_2026-03-26.md', 'text/markdown',
        '# Baubesprechung Nr. 11\n\n' +
        '**Datum:** 26.03.2026, 10:00–11:15 Uhr\n' +
        '**Ort:** Baubüro Container, Messestraße 42\n\n' +
        '**Teilnehmer:**\n' +
        '- Dipl.-Ing. Thomas Berger (Bauleitung)\n' +
        '- Arch. Sabine Lechner (Entwurf)\n' +
        '- Hr. Josef Bauer (Bauer Tiefbau)\n\n' +
        '---\n\n' +
        '## TOP 1: Fortschritt Aushub\n\n' +
        'Aushub Abschnitt B1 abgeschlossen. Verdichtungsprobe bestanden.\n' +
        'Abschnitt B2 begonnen, planmäßiger Fortschritt.\n\n' +
        '## TOP 2: Spundwandarbeiten\n\n' +
        'Spundwand Achse 1–3 fertiggestellt. Dichtigkeitsprüfung o.B.\n' +
        'Weiter mit Achse 3–5 ab KW 14.\n\n' +
        '## TOP 3: Nächste Schritte\n\n' +
        '- Aushub B2 fertigstellen (Ziel: 05.04.2026)\n' +
        '- Spundwand Achse 3–5\n' +
        '- Grundwassermessungen 2x wöchentlich\n\n' +
        '---\n\n' +
        '*Protokoll erstellt: Th. Berger, 26.03.2026*\n',
        protokolle);

      await file('Abnahmeprotokoll_Vorlage.txt', 'text/plain',
        'ABNAHMEPROTOKOLL\n' +
        '=================\n\n' +
        'Projekt:     Neubau Bürogebäude TechPark München Ost\n' +
        'Gewerk:      ____________________________\n' +
        'Firma:       ____________________________\n' +
        'Datum:       ____________________________\n\n' +
        'Teilnehmer:\n' +
        '- Bauherr:       ____________________________\n' +
        '- Bauleitung:    ____________________________\n' +
        '- Auftragnehmer: ____________________________\n\n' +
        'Abnahmeart:  [ ] Förmliche Abnahme  [ ] Teilabnahme  [ ] Schlussabnahme\n\n' +
        'Festgestellte Mängel:\n' +
        'Nr. | Beschreibung | Frist | Nachbesserung erfolgt\n' +
        '----|-------------|-------|---------------------\n' +
        '    |             |       |\n' +
        '    |             |       |\n' +
        '    |             |       |\n\n' +
        'Ergebnis:\n' +
        '[ ] Abnahme erklärt (ohne Mängel)\n' +
        '[ ] Abnahme erklärt (mit Mängelvorbehalt)\n' +
        '[ ] Abnahme verweigert (wesentliche Mängel)\n\n' +
        'Gewährleistungsbeginn: ____________________________\n' +
        'Gewährleistungsende:   ____________________________\n\n' +
        'Unterschriften:\n\n' +
        '____________________________    ____________________________\n' +
        'Bauherr / Bauleitung            Auftragnehmer\n',
        protokolle);

      // ── 06 Fotos ──
      await file('Baustellenübersicht_2026-03-10.svg', 'image/svg+xml',
        makeSVG('Baustellenübersicht — 10.03.2026\nAushubarbeiten Abschnitt B1', '#4a6fa5'),
        fotos);

      await file('Spundwand_Achse1-3_2026-03-25.svg', 'image/svg+xml',
        makeSVG('Spundwandarbeiten Achse 1–3\n25.03.2026', '#5a8f5a'),
        fotos);

      await file('Baugrube_von_oben_2026-04-01.svg', 'image/svg+xml',
        makeSVG('Baugrube — Drohnenaufnahme\n01.04.2026', '#7a6a8a'),
        fotos);

      await file('Baustellenzufahrt_2026-03-05.svg', 'image/svg+xml',
        makeSVG('Baustelleneinrichtung / Zufahrt Tor 1\n05.03.2026', '#8a7a5a'),
        fotos);

      // ── 07 Verträge ──
      await file('Generalplanervertrag_Entwurf.txt', 'text/plain',
        'GENERALPLANERVERTRAG (Entwurf)\n' +
        '===============================\n\n' +
        'zwischen\n\n' +
        'Müller & Schmidt Immobilien GmbH\n' +
        'Leopoldstraße 120, 80802 München\n' +
        '(nachfolgend „Auftraggeber")\n\n' +
        'und\n\n' +
        'Architekten Lechner & Kollegen PartGmbB\n' +
        'Maximilianstraße 35, 80539 München\n' +
        '(nachfolgend „Auftragnehmer")\n\n' +
        'über die Generalplanung für den Neubau eines Bürogebäudes\n' +
        'auf dem Grundstück Messestraße 42, 81829 München.\n\n' +
        '§ 1 Leistungsumfang\n' +
        'Der Auftragnehmer erbringt Planungsleistungen der Leistungsphasen\n' +
        '1–9 gemäß HOAI 2021, § 34 für folgende Fachbereiche:\n' +
        '- Objektplanung Gebäude\n' +
        '- Tragwerksplanung (Unterauftrag)\n' +
        '- TGA-Planung (Unterauftrag)\n' +
        '- Freianlagenplanung\n\n' +
        '§ 2 Honorar\n' +
        'Das Honorar wird auf Basis der HOAI 2021 berechnet:\n' +
        '- Anrechenbare Kosten: 24.240.000 EUR (KG 300 + 400)\n' +
        '- Honorarzone: IV\n' +
        '- Honorarsatz: Mitte\n' +
        '- Geschätztes Gesamthonorar: ca. 1.650.000 EUR netto\n\n' +
        '§ 3 Termine\n' +
        '- LP 1-2: abgeschlossen\n' +
        '- LP 3-4: bis 30.11.2025\n' +
        '- LP 5: bis 28.02.2026\n' +
        '- LP 6-7: bis 30.06.2026\n' +
        '- LP 8: baubegleitend\n' +
        '- LP 9: nach Abnahme\n\n' +
        '[Weitere Paragraphen: Haftung, Versicherung, Kündigung, etc.]\n',
        vertraege);

      await file('Bürgschaftsübersicht.csv', 'text/csv',
        'Firma;Art der Bürgschaft;Betrag (EUR);Bank;Gültig bis;Status\n' +
        'Bauer Tiefbau GmbH;Vertragserfüllungsbürgschaft;185.000;Sparkasse München;31.12.2026;Vorliegend\n' +
        'Bauer Tiefbau GmbH;Gewährleistungsbürgschaft;92.500;Sparkasse München;31.12.2031;Noch nicht fällig\n' +
        'Züblin AG;Vertragserfüllungsbürgschaft;820.000;Deutsche Bank;28.02.2028;Vorliegend\n' +
        'Elektro Müller GmbH;Vertragserfüllungsbürgschaft;230.000;Volksbank München;31.03.2028;Vorliegend\n' +
        'Haustechnik Süd GmbH;Vertragserfüllungsbürgschaft;350.000;Commerzbank;28.02.2029;Vorliegend\n',
        vertraege);

      // ── 08 Arbeitssicherheit ──
      await file('SiGePlan_Übersicht.md', 'text/markdown',
        '# Sicherheits- und Gesundheitsschutzplan (SiGePlan)\n\n' +
        '**Projekt:** Neubau Bürogebäude TechPark München Ost\n' +
        '**SiGeKo:** Ing. Andrea Hofmann\n' +
        '**Stand:** März 2026\n\n' +
        '## Gefährdungsbeurteilung — Aktuelle Bauphase (Erdarbeiten)\n\n' +
        '| Gefährdung | Maßnahme | Verantwortlich |\n' +
        '|------------|----------|----------------|\n' +
        '| Absturz in Baugrube | Absturzsicherung (Geländer), Zugangsleiter | Polier |\n' +
        '| Baugrubeneinbruch | Verbau gemäß statischer Berechnung, tägliche Sichtprüfung | Fachbauleiter |\n' +
        '| Überfahren/Anfahren | Einweiser bei Rückwärtsfahrt, getrennte Verkehrswege | Polier |\n' +
        '| Lärm | Gehörschutz ab 85 dB(A), Lärmminderung an Quelle | Alle Gewerke |\n' +
        '| Staub | Befeuchtung der Fahrbahnen, Staubschutzmasken | Bauer Tiefbau |\n' +
        '| Grundwasserkontakt | Wasserdichte Kleidung, Hautschutzplan | Bauer Tiefbau |\n\n' +
        '## Persönliche Schutzausrüstung (PSA)\n\n' +
        'Auf der gesamten Baustelle gilt:\n' +
        '- Schutzhelm (EN 397)\n' +
        '- Sicherheitsschuhe S3 (EN ISO 20345)\n' +
        '- Warnweste (EN ISO 20471, Klasse 2)\n' +
        '- Schutzbrille bei Schleif- und Bohrarbeiten\n' +
        '- Gehörschutz bei Arbeiten > 85 dB(A)\n\n' +
        '## Notfallplan\n\n' +
        '- **Notruf:** 112\n' +
        '- **Ersthelfer:** Michael Gruber (Polier), Hr. Bauer\n' +
        '- **Erste-Hilfe-Kasten:** Baubüro + jede Bauebene\n' +
        '- **Sammelplatz:** Parkplatz Messestraße 38\n' +
        '- **Nächstes Krankenhaus:** Klinikum Bogenhausen (4,2 km)\n',
        sicherheit);

      await file('Unterweisungsnachweis_2026-03.csv', 'text/csv',
        'Datum;Name;Firma;Gewerk;Thema;Unterweisung durch;Unterschrift\n' +
        '01.03.2026;Gruber, Michael;Bauer Tiefbau;Erdarbeiten;Erstunterweisung Baustellenordnung;Hofmann, Andrea;Ja\n' +
        '01.03.2026;Schmidt, Peter;Bauer Tiefbau;Erdarbeiten;Erstunterweisung Baustellenordnung;Hofmann, Andrea;Ja\n' +
        '01.03.2026;Kovac, Ivan;Bauer Tiefbau;Erdarbeiten;Erstunterweisung Baustellenordnung;Hofmann, Andrea;Ja\n' +
        '01.03.2026;Nowak, Piotr;Bauer Tiefbau;Erdarbeiten;Erstunterweisung Baustellenordnung;Hofmann, Andrea;Ja\n' +
        '01.03.2026;Yilmaz, Mehmet;Bauer Tiefbau;Erdarbeiten;Erstunterweisung Baustellenordnung;Hofmann, Andrea;Ja\n' +
        '05.03.2026;Huber, Franz;Bauer Tiefbau;Baggerführer;Unterweisung Erdbaumaschinen;Gruber, Michael;Ja\n' +
        '05.03.2026;Keller, Hans;Bauer Tiefbau;Baggerführer;Unterweisung Erdbaumaschinen;Gruber, Michael;Ja\n' +
        '10.03.2026;Alle AN;Bauer Tiefbau;Erdarbeiten;Sicherheitsbegehung Baugrube;Hofmann, Andrea;Ja\n' +
        '15.03.2026;Alle AN;Bauer Tiefbau;Erdarbeiten;Arbeiten in kontaminierten Bereichen;Hofmann, Andrea;Ja\n' +
        '22.03.2026;Alle AN;Bauer Tiefbau;Erdarbeiten;Verhalten bei Grundwassereintritt;Hofmann, Andrea;Ja\n',
        sicherheit);

      await file('Unfallbericht_Vorlage.txt', 'text/plain',
        'UNFALLBERICHT / VERBANDBUCHEINTRAG\n' +
        '====================================\n\n' +
        'Baustelle:    Neubau Bürogebäude TechPark München Ost\n' +
        'Datum/Uhrzeit: _______________ / _______\n\n' +
        'Verletzte Person:\n' +
        'Name:          ____________________________\n' +
        'Firma:         ____________________________\n' +
        'Gewerk:        ____________________________\n\n' +
        'Unfallhergang:\n' +
        '_______________________________________________\n' +
        '_______________________________________________\n' +
        '_______________________________________________\n\n' +
        'Art der Verletzung:\n' +
        '_______________________________________________\n\n' +
        'Erste Hilfe geleistet durch:\n' +
        '_______________________________________________\n\n' +
        'Maßnahmen:\n' +
        '[ ] Erste Hilfe vor Ort\n' +
        '[ ] Arztbesuch / Durchgangsarzt\n' +
        '[ ] Krankenhauseinweisung\n' +
        '[ ] Rettungsdienst gerufen\n\n' +
        'Unfallursache / Empfehlung:\n' +
        '_______________________________________________\n' +
        '_______________________________________________\n\n' +
        'Erstellt von: ______________ Datum: __________\n',
        sicherheit);

      // ── Files at project root level ──
      await file('Projektübersicht.md', 'text/markdown',
        '# Neubau Bürogebäude — TechPark München Ost\n\n' +
        '## Projektdaten\n\n' +
        '| Eigenschaft | Wert |\n' +
        '|-------------|------|\n' +
        '| Bauherr | Müller & Schmidt Immobilien GmbH |\n' +
        '| Standort | Messestraße 42, 81829 München |\n' +
        '| Generalplaner | Architekten Lechner & Kollegen PartGmbB |\n' +
        '| Bauleitung | Berger Baumanagement GmbH |\n' +
        '| Baubeginn | 01.03.2026 |\n' +
        '| Fertigstellung | 15.09.2028 (geplant) |\n' +
        '| Gesamtbudget | 38,5 Mio. EUR (brutto) |\n\n' +
        '## Ordnerstruktur\n\n' +
        '```\n' +
        '01 Planung/          — Projektbeschreibung, Raumprogramm, Terminplan\n' +
        '02 Genehmigungen/    — Baugenehmigung, Gutachten, Brandschutz\n' +
        '03 Bauausführung/    — Baustellenordnung, Nachunternehmer, Tagesberichte\n' +
        '04 Kostenplanung/    — DIN 276, Zahlungspläne, Nachträge\n' +
        '05 Protokolle/       — Baubesprechungen, Abnahmen\n' +
        '06 Fotos/            — Baudokumentation\n' +
        '07 Verträge/         — Planervertrag, Bürgschaften\n' +
        '08 Arbeitssicherheit/ — SiGePlan, Unterweisungen\n' +
        '```\n\n' +
        '## Ansprechpartner\n\n' +
        '| Name | Rolle | Telefon |\n' +
        '|------|-------|---------|\n' +
        '| Dr. Martin Müller | Bauherr | 089 / 12345-100 |\n' +
        '| Arch. Sabine Lechner | Generalplanerin | 089 / 98765-200 |\n' +
        '| Dipl.-Ing. Thomas Berger | Bauleiter | 0171 555 2341 |\n' +
        '| Ing. Andrea Hofmann | SiGeKo | 0172 888 4567 |\n' +
        '| Michael Gruber | Polier | 0170 333 9876 |\n',
        projekt, { shared: true, sharedWith: [
          { name: 'Sabine Lechner', email: 'lechner@arch-lk.de', permission: 'edit' },
          { name: 'Thomas Berger', email: 'berger@bau-mg.de', permission: 'edit' },
          { name: 'Andrea Hofmann', email: 'hofmann@sigeko.de', permission: 'view' }
        ]});

      await file('Kontaktliste.csv', 'text/csv',
        'Name;Firma;Rolle;E-Mail;Telefon;Mobiltelefon\n' +
        'Dr. Martin Müller;Müller & Schmidt Immobilien GmbH;Bauherr;mueller@ms-immo.de;089 12345-100;0171 111 2233\n' +
        'Arch. Sabine Lechner;Architekten Lechner & Kollegen;Generalplanerin;lechner@arch-lk.de;089 98765-200;0172 222 3344\n' +
        'Dipl.-Ing. Thomas Berger;Berger Baumanagement GmbH;Bauleiter;berger@bau-mg.de;089 54321-50;0171 555 2341\n' +
        'Ing. Andrea Hofmann;Hofmann Sicherheitstechnik;SiGeKo;hofmann@sigeko.de;089 77777-10;0172 888 4567\n' +
        'Hr. Josef Bauer;Bauer Tiefbau GmbH;Erdarbeiten;bauer@bauer-tiefbau.de;089 66666-30;0170 444 5566\n' +
        'Fr. Claudia Kellner;Züblin AG, NL München;Rohbau;kellner@zueblin.de;089 55555-20;0171 666 7788\n' +
        'Michael Gruber;Bauer Tiefbau GmbH;Polier;gruber@bauer-tiefbau.de;;0170 333 9876\n' +
        'Hr. Werner Weiss;Metallbau Schüco Partner;Fassade;weiss@schueco-partner.de;089 44444-15;0172 999 0011\n' +
        'Hr. Karl Müller;Elektro Müller GmbH;Elektro;k.mueller@elektro-mueller.de;089 33333-25;0173 111 2244\n' +
        'Fr. Petra Wagner;Haustechnik Süd GmbH;HLKS;wagner@ht-sued.de;089 22222-35;0174 222 3355\n',
        projekt);

      // Mark as seeded
      localStorage.setItem('opendocs-seeded', '1');
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
