+++
title = "Rust-based OS booting with UEFI (2)"
date = 2023-10-24

[taxonomies]
categories = ["uefi-os"]
tags = ["uefi", "efi", "os", "rust"]
+++

> All code of this tutorial can be accessed at my [GitHub repo](https://github.com/cnwzhjs/blog-uefi-os)

### What is an OS?

In modern days, the word 'OS' may denote many things.

OS can be used to name a kernel, e.g. Linux, Mach (the kernel of macOS), and etc.

OS can also be used to name a kernel and a set of userland programs, e.g. GNU/Linux, macOS, and etc.

In this series of articles, we mainly focus on the kernel part of an OS.

In term of an OS kernel, let's talk about what tasks should be done by an OS kernel.

The major role of an OS kernel is to provide a virtualization abstraction of hardware resources, and to provide a set of APIs for userland programs to use these resources.

In this definition, an OS kernel should:

1. Manages computational (CPU, GPU, application specific accelerators) and storage resources (memory, disks, and etc.), and distribute them to userland programs.
2. Provides a unified interface to operate periphrals (keyboard, mouse, network, and etc.).

Therefore, in this episode, we will try to detect the core hardware resources of the device via UEFI interface:

1. CPU
2. Memory layout
3. Graphics

<!-- more -->

### The `cpuid` instruction

For all x86 CPUs, there is a special instruction called `cpuid`. It is used to query the CPU's features. In rust, we can use the `raw-cpuid` crate to access this instruction.

```rust
fn print_cpu_info() {
    let cpuid = CpuId::new();
    let vendor_info = cpuid.get_vendor_info().unwrap();
    println!("Vendor: {}", vendor_info.as_str());
    let brand_info = cpuid.get_processor_brand_string().unwrap();
    println!("Processor: {}", brand_info.as_str());
    let feature_info = cpuid.get_feature_info().unwrap();
    let extended_processor_feature_info = cpuid.get_extended_processor_and_feature_identifiers().unwrap();
    let advanced_pm_info = cpuid.get_advanced_power_mgmt_info().unwrap();
    println!("Family: {:02X}h, Model: {:02X}h, Step: {:02X}h", feature_info.family_id(), feature_info.model_id(), feature_info.stepping_id());
    println!("Max logical processor ids: {}", feature_info.max_logical_processor_ids());
    println!("Features:");
    println!("    vmx: {}", feature_info.has_vmx());
    println!("    hypervisor: {}", feature_info.has_hypervisor());
    println!("    tsc: {}", feature_info.has_tsc());
    println!("    psn: {}", feature_info.has_psn());
    println!("    sysenter & sysexit: {}", feature_info.has_sysenter_sysexit());
    println!("    syscall & sysret: {}", extended_processor_feature_info.has_syscall_sysret());
    println!("    svm: {}", extended_processor_feature_info.has_svm());
    println!("    de: {}", extended_processor_feature_info.has_execute_disable());
    println!("    1g pages: {}", extended_processor_feature_info.has_1gib_pages());
    println!("    rdtscp: {}", extended_processor_feature_info.has_rdtscp());
    println!("    invariant tsc: {}", advanced_pm_info.has_invariant_tsc());
}
```

In the above code, we fetched CPU's foundamental information. What's more important is detecting CPU features. We see a lot of abbreviations, let's explain the features required by our OS one by one:

1. `tsc`: Time Stamp Counter, a high resolution timer. (this is used to detect if the CPU supports `rdtsc` instruction)
2. `syscall` & `sysret`: System Call and System Return, a pair of instructions used to switch between userland and kernel. (if you read some old OS tutorials, they may use `int` instruction to switch between userland and kernel. The two new instructions are more efficient than `int` instruction, and they are most commonly used by modern OSes)

For the rest of the features, we will explain them in later episodes.

### Detecting memory layout

When we came from BIOS era, the memory layout is very simple. The first 1MB of memory is reserved for BIOS, and the rest of memory is available for OS.

However, UEFI provides much more rich features. As a result, the memory layout is much more complicated.

In UEFI, the memory layout is described by a table called `EFI_MEMORY_DESCRIPTOR`. We can use the `SystemTable<Boot>::get_memory_map()` from the `uefi` crate to access this table:

```rust
fn print_memory_info(system_table: &mut SystemTable<Boot>) {
    // fetch the memory layout
    let mut buf = [0u8; 16_384];
    let buf_ptr = buf.as_ptr() as usize;

    let memory_map = system_table.boot_services().memory_map(&mut buf).unwrap();

    // print the memory layout
    println!("Memory map:");
    println!("{:16} {:16} {:12} {:8} {}", "Physical Addr", "Virtual Addr", "Num Pages", "Size", "Type");

    let mut i = 0;
    let mut total_pages = 0;
    let mut usable_pages = 0;

    for descriptor in memory_map.entries() {
        total_pages += descriptor.page_count;
        if descriptor.ty == MemoryType::CONVENTIONAL {
            usable_pages += descriptor.page_count;
        }

        if i != 0 && (i % 39) == 0 {
            println!("--- MORE ---");
            wait_for_any_key(system_table);
        }

        print!(
            "{:016X} {:016X} {:12} ",
            descriptor.phys_start,
            descriptor.virt_start,
            descriptor.page_count,
        );

        print_size_of_pages(descriptor.page_count as usize);

        println!(" {:?} ({:?})", descriptor.ty, descriptor.att);

        i += 1;
    }

    println!("--- END ---");
    print!("Total: ");
    print_size_of_pages(total_pages as usize);
    print!(", Usable: ");
    print_size_of_pages(usable_pages as usize);
    println!();
    println!();

    println!("buf (stack) is located at {:016X}, section:", buf_ptr);
    print_pointer_section(buf_ptr, &memory_map);

    let heap_buf = system_table.boot_services().allocate_pool(MemoryType::LOADER_DATA, 1024).unwrap();
    let heap_buf_ptr = heap_buf as usize;
    println!("heap_buf is located at {:016X}, section:", heap_buf_ptr);
    print_pointer_section(heap_buf_ptr, &memory_map);
    system_table.boot_services().free_pool(heap_buf).unwrap();    
}
```

If you run this code, you will see UEFI segmented memory space into many sections.
What we really care about is the `CONVENTIONAL` memory section, which is the memory available for OS.

### Detecting graphics

Usually OS tutorials only focus on the under-the-hood part of OS kernels. Most of them runs under text mode. However, I have a very different taste on this.

The story goes back to 1995, the first time I met with a computer. That was a Pentium 133MHz computer running MS-DOS 6.22. I was fascinated by the graphics experience that I can operate via QBASIC. This was the first time, I felt that I can unleash my creativity via a computer.

BIOS provides a very simple interface to access graphics interface via `int 10h`. Most DOS games use this interface to provide an immersive game play experience.

UEFI provides services via a terminology called protocols. The graphics protocol is called `EFI_GRAPHICS_OUTPUT_PROTOCOL`. Here's the code to access this protocol:

```rust
fn print_display_info(image_handle: Handle, system_table: &mut SystemTable<Boot>) {
    let boot_services = system_table.boot_services();
    let gop_handle = boot_services.get_handle_for_protocol::<GraphicsOutput>().unwrap();

    let gop = unsafe { system_table
        .boot_services()
        .open_protocol::<GraphicsOutput>(OpenProtocolParams {
            handle: gop_handle,
            agent: image_handle,
            controller: None
        }, OpenProtocolAttributes::GetProtocol
    ) }.unwrap();

    println!("Supported Modes:");
    for mode in gop.modes() {
        println!(
            "    {:4} x {:4} @ {:?}",
            mode.info().resolution().0,
            mode.info().resolution().1,
            mode.info().pixel_format()
        );
    };

    let current_mode = gop.current_mode_info();
    println!("Current Mode:");
    println!(
        "    {:4} x {:4} @ {:?}",
        current_mode.resolution().0,
        current_mode.resolution().1,
        current_mode.pixel_format()
    );
}
```

What should be explained in the above code are two APIs:

1. `get_handle_for_protocol`: This API is used to get the handle of a protocol. In UEFI, a protocol is identified by a GUID. The GUID of graphics output protocol has been hardcoded in the `uefi::proto::console::gop::GraphicsOutput`. This handle is required to get the actual service.

2. `open_protocol`: This API is used to get the actual service provided by an UEFI driver.

By sequencely invoking these APIs, we can get foundamental features of the graphics device.

Detailed documents can be found at [`uefi` document](https://docs.rs/uefi/0.25.0/uefi/proto/console/gop/struct.GraphicsOutput.html).

We can use these APIs to change the resolution of the screen (`set_mode(&mut self, mode: &Mode)`), to access the framebuffer (`frame_buffer(&mut self)`), and to use `blt` to perform screen cleaning and scrolling.

### What's next

In the next episode, we will try to switch the graphics mode, and print logs to the screen.

### Read more

Previous Article: [Get started](/rust-based-os-botting-with-uefi-1/)
