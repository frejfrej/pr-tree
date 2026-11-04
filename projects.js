module.exports = {
    'SECOLLAB': {
        repositories: ['products.secollab', 'products.secollab.client', 'products.secollab.packaging', 'products.web.oslc'],
        jiraProjects: ['SECOLLAB', "PRDOSLC", "WEBCMN"],
        jiraRegex: /(SECOLLAB-\d+|PRDOSLC-\d+|WEBOSLC-\d+|WEBCMN-\d+)/gi
    },
    'OSLC': {
        repositories: ['products.web.oslc', 'products.web.common', 'products.oslc'],
        jiraProjects: ['WEBCMN', "PRDOSLC"],
        jiraRegex: /(WEBOSLC-\d+|WEBCMN-\d+|PRDOSLC-\d+)/gi
    },
    // Add more projects as needed
};