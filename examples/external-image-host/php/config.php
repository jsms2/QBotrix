<?php
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

declare(strict_types=1);

// Keep this file and storage outside the web document root (public/).
function image_positive_env(string $name, float $fallback, float $maximum): float {
    $raw = getenv($name);
    if ($raw === false || $raw === '') return $fallback;
    if (!is_numeric($raw)) throw new RuntimeException('Invalid TTL/cleanup interval');
    $number = (float)$raw;
    if (!is_finite($number) || $number <= 0 || $number > $maximum) throw new RuntimeException('Invalid TTL/cleanup interval');
    return $number;
}

function image_config(): array {
    if (PHP_INT_SIZE < 8) throw new RuntimeException('64-bit PHP is required');
    $token = getenv('IMAGE_UPLOAD_TOKEN') ?: '';
    $ttl = image_positive_env('IMAGE_TTL_SECONDS', 86400, 31536000);
    $interval = image_positive_env('CLEANUP_INTERVAL_SECONDS', 600, 86400);
    if (strlen($token) < 16) throw new RuntimeException('IMAGE_UPLOAD_TOKEN must contain at least 16 characters');
    $storage = getenv('IMAGE_STORAGE_DIR') ?: __DIR__ . '/storage';
    if (!is_dir($storage) && !mkdir($storage, 0700, true) && !is_dir($storage)) throw new RuntimeException('Cannot create storage');
    $storage = realpath($storage);
    if ($storage === false) throw new RuntimeException('Invalid storage directory');
    $public = realpath(__DIR__ . '/public');
    if ($public !== false && str_starts_with(strtolower($storage . DIRECTORY_SEPARATOR), strtolower($public . DIRECTORY_SEPARATOR))) {
        throw new RuntimeException('Storage must be outside the public directory');
    }
    return ['token' => $token, 'ttl_ms' => $ttl * 1000, 'interval' => $interval, 'storage' => $storage];
}

function image_name(string $name): ?array {
    return preg_match('/^(\d{13})-[a-f0-9]{32}\.(png|jpg)$/D', $name, $match) === 1 ? $match : null;
}

function image_cleanup(array $config, bool $force = false): void {
    $lock = fopen($config['storage'] . '/.cleanup.lock', 'c+');
    if ($lock === false) throw new RuntimeException('Cannot open cleanup lock');
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) return;
        $last = (float)stream_get_contents($lock);
        $now = microtime(true);
        if (!$force && $now - $last < $config['interval']) return;
        foreach (new DirectoryIterator($config['storage']) as $entry) {
            $match = image_name($entry->getFilename());
            if ($match !== null && !$entry->isLink() && $entry->isFile() && (float)$match[1] <= $now * 1000) {
                if (!unlink($entry->getPathname()) && file_exists($entry->getPathname())) throw new RuntimeException('Cannot delete expired image');
            }
        }
        rewind($lock);
        ftruncate($lock, 0);
        fwrite($lock, (string)$now);
        fflush($lock);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
