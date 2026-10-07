<?php
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 jsms2 and QBotrix contributors

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/config.php';
try {
    $config = image_config();
    $watch = in_array('--watch', $argv, true);
    do {
        image_cleanup($config, true);
        if ($watch) {
            $seconds = (int)floor($config['interval']);
            time_nanosleep($seconds, (int)(($config['interval'] - $seconds) * 1000000000));
        }
    } while ($watch);
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
}
