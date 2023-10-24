window.addEventListener('load', function() {
    console.log("onload");
    var menuOpen = false;

    var eleMenu = document.getElementById("mobile-menu");
    var eleCloseImg = document.getElementById("close-img");
    var eleMenuImg = document.getElementById("menu-img");
    var eleMenuBtn = document.getElementById("menu-btn");

    function updateMenuStatus() {
        if (!eleMenu || !eleCloseImg || !eleMenuImg) {
            return;
        }

        if (menuOpen) {
            eleMenu.classList.remove("hidden");
            eleCloseImg.classList.remove("hidden");
            eleCloseImg.classList.add("block");
            eleMenuImg.classList.remove("block");
            eleMenuImg.classList.add("hidden");
        } else {
            eleMenu.classList.add("hidden");
            eleCloseImg.classList.add("hidden");
            eleCloseImg.classList.remove("block");
            eleMenuImg.classList.add("block");
            eleMenuImg.classList.remove("hidden");
        }
    }

    updateMenuStatus();

    function closeMenu() {
        menuOpen = false;
        updateMenuStatus();
    }

    function openMenu() {
        menuOpen = true;
        updateMenuStatus();
    }

    function toggleMenu() {
        menuOpen = !menuOpen;
        console.log("toggleMenu", menuOpen);
        updateMenuStatus();
    }

    if (eleMenuBtn) {
        eleMenuBtn.onclick = toggleMenu;
    }
});
