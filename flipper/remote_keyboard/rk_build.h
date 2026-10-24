#pragma once

/*
 * Build variants (docs/flipper-app.md#build-variants), selected with RK_DEBUG=1
 * or RK_DEMO=1 in application.fam.
 */

#if defined(RK_DEBUG) && defined(RK_DEMO)
#error "RK_DEBUG and RK_DEMO cannot be combined"
#endif

#ifdef RK_DEBUG
#define RK_DEBUG_BUILD true
#define RK_BUILD_NAME  "debug"
#else
#define RK_DEBUG_BUILD false
#endif

#ifdef RK_DEMO
#define RK_DEMO_BUILD true
#define RK_BUILD_NAME "demo"
#else
#define RK_DEMO_BUILD false
#endif

#ifndef RK_BUILD_NAME
#define RK_BUILD_NAME "release"
#endif

/* USB stays in serial mode and nothing is typed: the debug and demo builds */
#define RK_USB_SERIAL_BUILD (RK_DEBUG_BUILD || RK_DEMO_BUILD)
