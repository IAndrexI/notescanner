const fs = require('fs');
const path = require('path');

class SeafileClient {
  constructor(serverUrl, token) {
    this.serverUrl = (serverUrl || '').trim().replace(/\/+$/, '');
    this.token = (token || '').trim();
  }

  getHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (this.token) {
      headers['Authorization'] = `Token ${this.token}`;
    }
    return headers;
  }

  // Obtain an auth token using username and password
  static async authenticate(serverUrl, username, password) {
    const url = `${serverUrl.trim().replace(/\/+$/, '')}/api2/auth-token/`;
    const body = new URLSearchParams({
      username: username.trim(),
      password: password
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        errorMsg = errJson.non_field_errors?.[0] || errJson.detail || errText || errorMsg;
      } catch (e) {}
      throw new Error(`Authentication failed: ${errorMsg}`);
    }

    const data = await response.json();
    return data.token;
  }

  // Validate the current token and retrieve account info
  async getAccountInfo() {
    const url = `${this.serverUrl}/api2/account/info/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to get account info: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // List all repositories/libraries the user has access to
  async listRepos() {
    const url = `${this.serverUrl}/api2/repos/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to list libraries: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // Ensure a directory exists (creates if not found)
  async ensureDir(repoId, parentDir, dirName) {
    try {
      const cleanParent = parentDir.endsWith('/') ? parentDir : `${parentDir}/`;
      const url = `${this.serverUrl}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(cleanParent)}`;
      const formData = new URLSearchParams({
        operation: 'mkdir',
        name: dirName
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }),
        body: formData.toString()
      });

      // Status 200/201 means created, 400 with 'already exists' is fine
      return true;
    } catch (e) {
      // Ignore if directory already exists
      return false;
    }
  }

  // Get the upload link for a repo and directory
  async getUploadLink(repoId, parentDir = '/') {
    const cleanDir = parentDir.startsWith('/') ? parentDir : `/${parentDir}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/upload-link/?p=${encodeURIComponent(cleanDir)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get upload link: HTTP ${response.status}`);
    }

    let link = await response.text();
    // Seafile might return a JSON string with quotes, e.g. "https://..."
    link = link.replace(/^"|"$/g, '').trim();
    return link;
  }

  // Upload a file buffer or stream directly to Seafile
  async uploadFile(repoId, parentDir, fileName, fileBuffer, mimeType = 'application/pdf') {
    const uploadUrl = await this.getUploadLink(repoId, parentDir);
    const cleanDir = parentDir.startsWith('/') ? parentDir : `/${parentDir}`;

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('parent_dir', cleanDir);
    formData.append('replace', '0');

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload failed: HTTP ${response.status} - ${errText}`);
    }

    return {
      success: true,
      fileName,
      path: `${cleanDir.replace(/\/+$/, '')}/${fileName}`
    };
  }

  // List files in a repo directory
  async listFiles(repoId, dirPath = '/') {
    const cleanDir = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/dir/?p=${encodeURIComponent(cleanDir)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders({ 'Accept': 'application/json' })
    });

    if (!response.ok) {
      throw new Error(`Failed to list directory contents: HTTP ${response.status}`);
    }

    return await response.json();
  }

  // Get download link for a file
  async getFileDownloadLink(repoId, filePath) {
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const url = `${this.serverUrl}/api2/repos/${repoId}/file/?p=${encodeURIComponent(cleanPath)}&reuse=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get file link: HTTP ${response.status}`);
    }

    let link = await response.text();
    return link.replace(/^"|"$/g, '').trim();
  }
}

module.exports = SeafileClient;
