<?php
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

declare(strict_types=1);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
require dirname(__DIR__) . '/config.php';

function respond(int $status, string $body = ''): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') echo $body;
    exit;
}

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
try {
    $config = image_config();
    image_cleanup($config);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if ($path === '/upload' && $method === 'POST') {
        $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (!hash_equals('Bearer ' . $config['token'], $authorization)) respond(401, 'Unauthorized');
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 31 * 1024 * 1024) respond(413, 'Request exceeds 31 MiB');
        $image = $_FILES['image'] ?? null;
        if (count($_FILES) !== 1 || count($_POST) !== 0 || !is_array($image) || is_array($image['error'])) respond(400, 'Exactly one image file is required');
        if ($image['error'] !== UPLOAD_ERR_OK) respond(in_array($image['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 400, 'Upload failed');
        $temporary = $image['tmp_name'];
        if (!is_uploaded_file($temporary)) respond(400, 'Invalid upload');
        $size = filesize($temporary);
        if ($size === false || $size === 0 || $size > 30 * 1024 * 1024) respond(413, 'Image must be nonempty and at most 30 MiB');
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($temporary);
        $info = @getimagesize($temporary);
        $expected = $mime === 'image/png' ? IMAGETYPE_PNG : ($mime === 'image/jpeg' ? IMAGETYPE_JPEG : null);
        if ($expected === null || $info === false || $info[2] !== $expected || $image['type'] !== $mime) respond(415, 'Only PNG/JPEG with matching MIME and content are allowed');
        $expires = (int)floor(microtime(true) * 1000 + $config['ttl_ms']);
        $name = $expires . '-' . bin2hex(random_bytes(16)) . ($mime === 'image/png' ? '.png' : '.jpg');
        $target = $config['storage'] . DIRECTORY_SEPARATOR . $name;
        if (!move_uploaded_file($temporary, $target)) throw new RuntimeException('Cannot save image');
        chmod($target, 0600);
        respond(201, '/images/' . $name);
    }
    if (is_string($path) && str_starts_with($path, '/images/')) {
        if (!in_array($method, ['GET', 'HEAD'], true)) { header('Allow: GET, HEAD'); respond(405); }
        $name = substr($path, 8);
        $match = image_name($name);
        if ($match === null || (float)$match[1] <= microtime(true) * 1000) respond(404);
        $file = $config['storage'] . DIRECTORY_SEPARATOR . $name;
        if (is_link($file) || !is_file($file)) respond(404);
        $stream = @fopen($file, 'rb');
        if ($stream === false) respond(404);
        $stat = fstat($stream);
        header('Content-Type: ' . ($match[2] === 'png' ? 'image/png' : 'image/jpeg'));
        header('Content-Length: ' . $stat['size']);
        if ($method === 'GET') fpassthru($stream);
        fclose($stream);
        exit;
    }
    if ($path === '/upload') { header('Allow: POST'); respond(405); }
    respond(404);
} catch (Throwable $error) {
    error_log((string)$error);
    respond(500, 'Internal server error');
}
