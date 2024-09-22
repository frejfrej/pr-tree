let previousAuthor = "Show all";
let previousReviewer = "Show all";

function filterPullRequests() {
    let author = document.getElementById("authorSelect").value;
    let reviewer = document.getElementById("reviewerSelect").value;
    let pullRequests = document.getElementsByClassName("pull-request");

    if (reviewer !== previousReviewer) {
        document.getElementById("authorSelect").value = "Show all";
        previousReviewer = reviewer;
        author = "Show all";
    } else if (author !== previousAuthor) {
        document.getElementById("reviewerSelect").value = "Show all";
        previousAuthor = author;
        reviewer = "Show all";
    }

    Array.from(pullRequests).forEach(pr => {
        let title = pr.querySelector("a");
        let authorImg = pr.querySelector("img");
        let reviewerApproved = false;
        let reviewerFound = false;

        if (reviewer !== "Show all") {
            let participants = pr.querySelectorAll(".image-container");
            for (let i = 1; i < participants.length; i++) {
                if (participants[i].dataset.author === reviewer) {
                    reviewerFound = true;
                    if (participants[i].dataset.reviewStatus === "approved") {
                        reviewerApproved = true;
                        break;
                    }
                }
            }
        }

        let display = "none";
        let titleColor = "black";

        if (author === "Show all" && reviewer === "Show all") {
            display = "";
        } else if (authorImg.alt === author) {
            display = "";
            if (pr.classList.contains("status-in-progress")) {
                titleColor = "var(--secondary-color)";
            }
        } else if (reviewerFound) {
            display = "";
            if (!reviewerApproved && !pr.classList.contains("status-in-progress")) {
                titleColor = "var(--secondary-color)";
            }
        }

        pr.style.display = display;
        title.style.color = titleColor;
    });
}

function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    const children = pullRequest.nextElementSibling;
    if (children && children.classList.contains('children')) {
        pullRequest.classList.toggle('collapsed');
        children.style.display = children.style.display === 'none' ? 'block' : 'none';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    let pullRequests = document.querySelectorAll('.pull-request');
    pullRequests.forEach(pr => {
        let children = pr.nextElementSibling;
        if (children && children.classList.contains('children')) {
            let toggleButton = document.createElement('button');
            toggleButton.innerHTML = '<i class="fas fa-chevron-down toggle-icon"></i>';
            toggleButton.style.marginLeft = '10px';
            toggleButton.onclick = function() { toggleChildren(pr); };
            pr.querySelector('p').appendChild(toggleButton);
        }
    });
});