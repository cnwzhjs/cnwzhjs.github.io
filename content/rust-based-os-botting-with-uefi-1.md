+++
title = "Rust-based OS booting with UEFI (1)"
date = 2023-10-15

[taxonomies]
categories = ["uefi-os"]
tags = ["uefi", "efi", "os", "rust"]
+++

> All code of this tutorial can be accessed at my [GitHub repo](https://github.com/cnwzhjs/blog-uefi-os)

### Time to Write OS Tutorials in UEFI

There are quite a lot of OS tutorials and YouTube videos out there. However, most of them are written to boot in BIOS mode.

However, it is 2023 now, 19 years since Intel open sourced UEFI. Meanwhile, Intel is trying to replace `x86_64` with `x86_64s`, which is a pure 64bit platform. And, of course, it will only support UEFI (UEFI CSM will be removed).

UEFI is a more secure and more powerful booting system. Almost all modern operating system are booted via UEFI. There seems to be no reason to continue writing OS tutorials for BIOS. Taking care about switching to long mode, or enabling paging is no longer necessary, but annoying technology details.

After searching Google, I see there are very limited information about writing OS in UEFI. The information are scattered in different places, and it is hard to find a complete tutorial. Therefore, I decided to write a series of tutorials about writing OS in UEFI.

<!-- more -->

### Setup Test Environment

Most OS tutorials uses QEMU for the test environment for following benefits:

1. Only requires normal user permission to execute (QEMU can run in a emulator mode, which means it doesn't need to access any hardware virtualization infrastructure, e.g. KVM).
2. It is very flexible, to be configured with different hardware configurations.
3. It support wide varieties of client CPU architectures. Additionaly, emulation can run on host CPUs with different architecture to client CPU.
4. It supports emulating BIOS or UEFI as firmware interface.
5. It supports debuggers, which ease debugging OS kernels (you usually uses logging to debug kernels on bare metal).

Therefore, in this tutorial, we uses QEMU for the test environment as well. Well, I uses a MacBook Pro, so the tutorial's command lines are for macOS, but it is easy to translate to Linux version.

1. Install QEMU

We usually use [homebrew](https://brew.sh) to install qemu:

```bash
brew install qemu
```

2. Create workspace for the project

```bash
mkdir tony-os && cd tony-os
git init .
mkdir -p src build buildenv {target,dist}/x86_64
```

3. Prepare UEFI firmware for QEMU

The open-sourced UEFI firmware from Intel is called the [TianoCore project](http://www.tianocore.org). The code is also hosted on [GitHub](https://github.com/tianocore).

In this project, they developed a firmware supporting QEMU that provides a UEFI environment.

We can just download it from the [CI artifacts server](https://www.kraxel.org/repos/jenkins/edk2/), find a file starts with "edk2.git-ovmf.x64", decompress it, and copy the `usr/share/edk2.git/ovmf-x64/OVMF-pure-efi.fd` to our workspace's `target/x86_64/bios.bin`.

4. Prepare the script to test our NON-EXIST under UEFI

Write `run.sh` script under our workspace:

```bash
#! /bin/bash

qemu-system-x86_64 \
    -L target/x86_64 \
    -bios target/x86_64/bios.bin \
    -hda fat:rw:dist/x86_64
```

Then, make it executable: `chmod +x run.sh`.

If you run this script, it should start and showing an image of TianoCore.

Now your workspace should be like this:

```text
build
buildenv
dist
|- x86_64
src
target
|- x86_64
   |- bios.bin
run.sh
```

### Prepare a build environment

Docker is a perfect platform to solidify your build environment. Therefore, we can prepare a `Dockerfile` under the `buildenv` folder, to build an image of the build environment:

```dockerfile
FROM rust:1.73-bullseye

RUN rustup target add x86_64-unknown-uefi

VOLUME /root/env

WORKDIR /root/env
```

> Rust has tier 2 support for UEFI targets, which means it is not officially supported. However, it is good enough for us to write a toy OS.
>
> Thanks to David Rheinsberg([@dvdhrm](https://github.com/dvdhrm)) and Nicholas Bishop([@nicholasbishop](https://github.com/nicholasbishop))

Build the docker image:

```bash
docker build --platform linux/x86_64 buildenv -t tonyos-buildenv
```

### Prepare a simplist kernel

David Rheinsberg, the maintainer of the UEFI targets, also maintains a crate called [r-efi](https://github.com/r-efi/r-efi) that provides a Rust interface to UEFI. We can use this crate to get started quickly.

1. Create the build script running in the build container: buildscript.sh

```bash
#! /bin/bash

# build the kernel
cargo build --target x86_64-unknown-uefi || exit 1

# copy the built kernel to the dist directory
mkdir -p dist/x86_64/EFI/BOOT || exit 1

cp target/x86_64-unknown-uefi/debug/tonyos.efi \
   dist/x86_64/EFI/BOOT/BOOTX64.EFI || exit 1
```

2. Create the build script to invoke the container: build.sh

```bash
#! /bin/bash

docker run -it \
    --platform linux/x86_64 \
    --rm \
    -v $(pwd):/root/env \
    tonyos-buildenv \
    ./buildscript.sh
```

3. Prepare the kernel entry file `src/main.rs`

```rust
#![no_main]
#![no_std]

extern crate r_efi;

use r_efi::efi;

#[panic_handler]
fn panic_handler(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

const HELLO_STR: &str = "Hello, world. Press any key to return to UEFI firmware.";

#[export_name = "efi_main"]
pub extern "C" fn main(_h: efi::Handle, st: *mut efi::SystemTable) -> efi::Status {
    let mut s = [0u16; HELLO_STR.len() + 1];
    let mut i = 0usize;
    for c in HELLO_STR.encode_utf16() {
        s[i] = c;
        i += 1;
        if i >= s.len() {
            break;
        }
    }

    // Print "Hello World!".
    let r =
        unsafe { ((*(*st).con_out).output_string)((*st).con_out, s.as_ptr() as *mut efi::Char16) };
    if r.is_error() {
        return r;
    }

    // Wait for key input, by waiting on the `wait_for_key` event hook.
    let r = unsafe {
        let mut x: usize = 0;
        ((*(*st).boot_services).wait_for_event)(1, &mut (*(*st).con_in).wait_for_key, &mut x)
    };
    if r.is_error() {
        return r;
    }

    efi::Status::SUCCESS
}
```

4. Prepare the `Cargo.toml` file

```toml
[package]
name = "tonyos"
version = "0.1.0"
authors = ["Tony Huang <tony@tonyhuang.dev>"]
edition = "2021"

[build]
build-stage = 1
target = ["x86_64-unknown-uefi"]

[dependencies]
r-efi = "4"

# the profile used for `cargo build`
[profile.dev]
panic = "abort" # disable stack unwinding on panic

# the profile used for `cargo build --release`
[profile.release]
panic = "abort" # disable stack unwinding on panic
```

### Build and run your first UEFI kernel

Now, we can build and run our first UEFI kernel:

```bash
./build.sh && ./run.sh
```

![UEFI Hello World](/images/uefi-first-boot.png)
